import { extract as createTarExtract } from "tar-stream";
import { createGunzip } from "node:zlib";
import type { Readable } from "node:stream";
import { CRITICAL_FILE_PATTERN, isRelevantPath } from "./path-relevance";
import type { RepositoryFile } from "./repository-service";

export type TarballOmission = { path?: string; reason: string; count?: number };

export type TarballExtractionLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
};

export type TarballExtractionResult = {
  files: RepositoryFile[];
  totalBytes: number;
  omissions: TarballOmission[];
};

/**
 * GitHub tarball entries are rooted at a synthetic "{owner}-{repo}-{shortsha}/"
 * directory; strip it so paths line up with the rest of the scan pipeline.
 */
function stripTarballRoot(entryName: string): string {
  const firstSlash = entryName.indexOf("/");
  return firstSlash === -1 ? entryName : entryName.slice(firstSlash + 1);
}

/**
 * Parses a gzipped tarball stream (as returned by GitHub's
 * /repos/{owner}/{repo}/tarball/{ref} endpoint) into scan-ready files,
 * applying the same relevance/size/depth filtering as the per-file blob
 * fetch path. This trades N HTTP round trips (one per file) for a single
 * streamed download, so it scales with repo size instead of file count.
 */
export async function extractRepositoryTarball(
  gzippedTarball: Readable,
  limits: TarballExtractionLimits
): Promise<TarballExtractionResult> {
  const files: RepositoryFile[] = [];
  const omissions: TarballOmission[] = [];
  let totalBytes = 0;
  let skippedByFileCount = 0;

  const extract = createTarExtract();

  extract.on("entry", (header, stream, next) => {
    const skip = () => {
      stream.resume();
      stream.on("end", next);
    };

    if (header.type !== "file") {
      skip();
      return;
    }

    const path = stripTarballRoot(header.name);
    if (!path) {
      skip();
      return;
    }

    const relevance = isRelevantPath(path);
    if (!relevance.include) {
      omissions.push({ path, reason: relevance.reason ?? "unsupported_format" });
      skip();
      return;
    }

    const depth = path.split("/").length;
    if (depth > limits.maxDepth) {
      omissions.push({ path, reason: "max_depth" });
      skip();
      return;
    }

    const declaredSize = header.size ?? 0;
    if (declaredSize > limits.maxFileBytes) {
      omissions.push({ path, reason: "max_file_size" });
      skip();
      return;
    }

    if (files.length >= limits.maxFiles) {
      skippedByFileCount += 1;
      skip();
      return;
    }

    if (totalBytes + declaredSize > limits.maxTotalBytes) {
      omissions.push({ path, reason: "max_total_size" });
      skip();
      return;
    }

    if (CRITICAL_FILE_PATTERN.test(path)) {
      omissions.push({ path, reason: "critical_file_detected" });
    }

    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => {
      chunks.push(chunk as Buffer);
    });
    stream.on("end", () => {
      const bytes = Buffer.concat(chunks);
      if (bytes.includes(0)) {
        omissions.push({ path, reason: "binary_file" });
        next();
        return;
      }
      if (totalBytes + bytes.byteLength > limits.maxTotalBytes) {
        omissions.push({ path, reason: "max_total_size" });
        next();
        return;
      }
      files.push({ path, content: bytes.toString("utf8"), size: bytes.byteLength, sha: "" });
      totalBytes += bytes.byteLength;
      next();
    });
    stream.resume();
  });

  await new Promise<void>((resolve, reject) => {
    extract.on("finish", resolve);
    extract.on("error", reject);
    gzippedTarball.on("error", reject);
    gzippedTarball.pipe(createGunzip()).on("error", reject).pipe(extract);
  });

  if (skippedByFileCount > 0) {
    omissions.push({ reason: "max_file_count", count: skippedByFileCount });
  }

  return { files, totalBytes, omissions };
}
