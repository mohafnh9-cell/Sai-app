import { isRelevantPath, CRITICAL_FILE_PATTERN } from "@/lib/github/path-relevance";
import { sanitizePath } from "@/features/security-scanner/path";
import type { RepositoryFile } from "@/lib/github/repository-service";

export type LocalFileOmission = { path?: string; reason: string; count?: number };

export type LocalFilesLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
};

export type LocalFilesNormalizationResult = {
  files: RepositoryFile[];
  totalBytes: number;
  omissions: LocalFileOmission[];
};

export class LocalFilesValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "LocalFilesValidationError";
  }
}

/**
 * Local Analysis (Phase 11): the browser-directory-picker counterpart to
 * extractZipArchive (Phase 10). The browser already read these files off
 * the user's disk via <input webkitdirectory> -- the server never receives
 * or resolves a filesystem path, only relative-path + content pairs the
 * browser already selected client-side. Applies the identical relevance
 * filtering and size/count/depth limits as the ZIP path so both ingestion
 * methods converge on the same RepositoryFile[] shape with the same
 * security posture -- no separate, weaker local-only limits.
 */
export function normalizeLocalFiles(
  entries: Array<{ path: string; content: Buffer }>,
  limits: LocalFilesLimits
): LocalFilesNormalizationResult {
  const files: RepositoryFile[] = [];
  const omissions: LocalFileOmission[] = [];
  let totalBytes = 0;
  let skippedByFileCount = 0;

  if (entries.length > limits.maxFiles * 10) {
    throw new LocalFilesValidationError(
      "too_many_entries",
      "This project has too many files to analyze."
    );
  }

  for (const entry of entries) {
    const path = sanitizePath(entry.path);
    if (!path) {
      omissions.push({ path: entry.path, reason: "unsafe_path" });
      continue;
    }

    const relevance = isRelevantPath(path);
    if (!relevance.include) {
      omissions.push({ path, reason: relevance.reason ?? "unsupported_format" });
      continue;
    }

    const depth = path.split("/").length;
    if (depth > limits.maxDepth) {
      omissions.push({ path, reason: "max_depth" });
      continue;
    }

    if (entry.content.byteLength > limits.maxFileBytes) {
      omissions.push({ path, reason: "max_file_size" });
      continue;
    }

    if (files.length >= limits.maxFiles) {
      skippedByFileCount += 1;
      continue;
    }

    if (totalBytes + entry.content.byteLength > limits.maxTotalBytes) {
      omissions.push({ path, reason: "max_total_size" });
      continue;
    }

    if (entry.content.includes(0)) {
      omissions.push({ path, reason: "binary_file" });
      continue;
    }

    if (CRITICAL_FILE_PATTERN.test(path)) {
      omissions.push({ path, reason: "critical_file_detected" });
    }

    files.push({
      path,
      content: entry.content.toString("utf8"),
      size: entry.content.byteLength,
      sha: "",
    });
    totalBytes += entry.content.byteLength;
  }

  if (skippedByFileCount > 0) {
    omissions.push({ reason: "max_file_count", count: skippedByFileCount });
  }
  if (entries.length === 0) {
    throw new LocalFilesValidationError("empty_project", "No files were selected.");
  }
  if (files.length === 0) {
    throw new LocalFilesValidationError(
      "no_source_files",
      "No supported source files were found in this project."
    );
  }

  return { files, totalBytes, omissions };
}
