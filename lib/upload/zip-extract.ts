import * as yauzl from "yauzl";
import { isRelevantPath, CRITICAL_FILE_PATTERN } from "@/lib/github/path-relevance";
import { sanitizePath } from "@/features/security-scanner/path";
import type { RepositoryFile } from "@/lib/github/repository-service";

export type ZipExtractionOmission = { path?: string; reason: string; count?: number };

export type ZipExtractionLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  /** Compressed archive size, checked before any decompression happens. */
  maxArchiveBytes: number;
};

export type ZipExtractionResult = {
  files: RepositoryFile[];
  totalBytes: number;
  omissions: ZipExtractionOmission[];
};

export class ZipValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ZipValidationError";
  }
}

const UNIX_MODE_TYPE_MASK = 0xf000;
const UNIX_MODE_SYMLINK = 0xa000;

/** True when a ZIP central-directory entry's external attributes mark it as a Unix symlink. */
function isSymlinkEntry(entry: yauzl.Entry): boolean {
  const madeByUnix = (entry.versionMadeBy >> 8) === 3;
  if (!madeByUnix) return false;
  const unixMode = entry.externalFileAttributes >>> 16;
  return (unixMode & UNIX_MODE_TYPE_MASK) === UNIX_MODE_SYMLINK;
}

/**
 * Streaming, security-hardened ZIP extractor for untrusted user uploads.
 * Mirrors lib/github/tarball-extract.ts's shape and safety properties
 * (same relevance filtering, same limit categories) so the result plugs
 * directly into the existing scan pipeline as a RepositoryFile[] -- nothing
 * is ever written to disk, so there is no filesystem path to escape.
 *
 * Defenses:
 *  - path traversal: two independent layers, both verified against
 *    hand-crafted malicious archive bytes in zip-extract.test.ts (not just
 *    a well-behaved writer library, which won't produce these in the first
 *    place). yauzl is opened with strictFileNames: true, which fails the
 *    ENTIRE archive the moment it parses a ".."-segment or absolute-path
 *    entry name -- fail-closed on the whole untrusted upload, not a
 *    per-entry skip. sanitizePath is a second, independent check on every
 *    surviving entry name (defense-in-depth if that parser guarantee were
 *    ever narrower than expected), rejecting "..", absolute paths, drive
 *    letters, and null bytes before a path is used for anything.
 *  - symlinks: rejected outright (never followed, never extracted).
 *  - decompression bombs: central-directory uncompressedSize is checked
 *    before opening each entry's stream (fast reject), AND yauzl's
 *    validateEntrySizes independently verifies actual decompressed bytes
 *    against the declared size, so a forged central directory can't hide a
 *    bomb behind a small declared size. A running total is also enforced
 *    across all entries.
 *  - malformed archives: yauzl's open/error events are wrapped so a corrupt
 *    or truncated ZIP produces a clean ZipValidationError, never a crash.
 */
export async function extractZipArchive(
  buffer: Buffer,
  limits: ZipExtractionLimits
): Promise<ZipExtractionResult> {
  if (buffer.byteLength > limits.maxArchiveBytes) {
    throw new ZipValidationError("archive_too_large", "Archive exceeds the maximum upload size.");
  }

  const files: RepositoryFile[] = [];
  const omissions: ZipExtractionOmission[] = [];
  let totalBytes = 0;
  let skippedByFileCount = 0;
  let entryCount = 0;

  const zipfile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, autoClose: true, strictFileNames: true, validateEntrySizes: true },
      (err, zip) => {
        if (err || !zip) {
          reject(new ZipValidationError("invalid_archive", "The archive could not be read."));
          return;
        }
        resolve(zip);
      }
    );
  });

  // Fast reject on the central directory's own entry count, before iterating
  // a single one -- a ZIP with an enormous number of (even empty) entries is
  // its own resource-exhaustion vector regardless of file content.
  if (zipfile.entryCount > limits.maxFiles * 10) {
    zipfile.close();
    throw new ZipValidationError(
      "too_many_entries",
      "Archive contains too many entries to analyze."
    );
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      zipfile.close();
      if (error) reject(error);
      else resolve();
    };

    zipfile.on("error", (err) => {
      finish(new ZipValidationError("corrupt_archive", err.message || "The archive is corrupt."));
    });

    zipfile.on("end", () => finish());

    zipfile.on("entry", (entry: yauzl.Entry) => {
      entryCount += 1;

      const isDirectory = /\/$/.test(entry.fileName);
      if (isDirectory) {
        zipfile.readEntry();
        return;
      }

      if (isSymlinkEntry(entry)) {
        omissions.push({ path: entry.fileName, reason: "symlink_rejected" });
        zipfile.readEntry();
        return;
      }

      const path = sanitizePath(entry.fileName);
      if (!path) {
        omissions.push({ path: entry.fileName, reason: "unsafe_path" });
        zipfile.readEntry();
        return;
      }

      const relevance = isRelevantPath(path);
      if (!relevance.include) {
        omissions.push({ path, reason: relevance.reason ?? "unsupported_format" });
        zipfile.readEntry();
        return;
      }

      const depth = path.split("/").length;
      if (depth > limits.maxDepth) {
        omissions.push({ path, reason: "max_depth" });
        zipfile.readEntry();
        return;
      }

      if (entry.uncompressedSize > limits.maxFileBytes) {
        omissions.push({ path, reason: "max_file_size" });
        zipfile.readEntry();
        return;
      }

      if (files.length >= limits.maxFiles) {
        skippedByFileCount += 1;
        zipfile.readEntry();
        return;
      }

      if (totalBytes + entry.uncompressedSize > limits.maxTotalBytes) {
        omissions.push({ path, reason: "max_total_size" });
        zipfile.readEntry();
        return;
      }

      if (CRITICAL_FILE_PATTERN.test(path)) {
        omissions.push({ path, reason: "critical_file_detected" });
      }

      zipfile.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          finish(new ZipValidationError("corrupt_archive", "The archive is corrupt."));
          return;
        }

        const chunks: Buffer[] = [];
        let bytesRead = 0;
        let aborted = false;

        stream.on("data", (chunk: Buffer) => {
          if (aborted) return;
          bytesRead += chunk.byteLength;
          // Defense-in-depth against a central directory that lies about
          // uncompressedSize: abort the moment actual decompressed bytes
          // exceed what a single file (or the running total) may contain,
          // regardless of what was declared.
          if (bytesRead > limits.maxFileBytes || totalBytes + bytesRead > limits.maxTotalBytes) {
            aborted = true;
            omissions.push({ path, reason: "max_file_size" });
            stream.destroy();
            zipfile.readEntry();
            return;
          }
          chunks.push(chunk);
        });

        stream.on("error", () => {
          if (aborted) return;
          finish(new ZipValidationError("corrupt_archive", "The archive is corrupt."));
        });

        stream.on("end", () => {
          if (aborted) return;
          const bytes = Buffer.concat(chunks);
          if (bytes.includes(0)) {
            omissions.push({ path, reason: "binary_file" });
            zipfile.readEntry();
            return;
          }
          files.push({ path, content: bytes.toString("utf8"), size: bytes.byteLength, sha: "" });
          totalBytes += bytes.byteLength;
          zipfile.readEntry();
        });
      });
    });

    zipfile.readEntry();
  });

  if (entryCount === 0) {
    throw new ZipValidationError("empty_archive", "The archive is empty.");
  }
  if (skippedByFileCount > 0) {
    omissions.push({ reason: "max_file_count", count: skippedByFileCount });
  }
  if (files.length === 0) {
    throw new ZipValidationError(
      "no_source_files",
      "No supported source files were found in this archive."
    );
  }

  return { files, totalBytes, omissions };
}
