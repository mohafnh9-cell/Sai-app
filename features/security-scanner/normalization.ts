import { DEFAULT_BINARY_EXTENSIONS } from "./constants";
import type { ScanConfig } from "./config";
import { extensionOf, sanitizePath } from "./path";
import type { InputFile, NormalizedFile, ScanOmission } from "./types";

function looksBinary(content: string): boolean {
  return content.includes("\0");
}

/**
 * Lower tier numbers are consumed first against maxFiles/maxTotalBytes, so
 * auth/api/config survive truncation before generic app code or tests.
 */
function priorityOf(path: string): number {
  const lower = path.toLowerCase();
  if (/(?:auth|middleware|session|jwt|rbac|permission)/.test(lower)) return 1;
  if (lower.includes("api/") || lower.includes("routes/")) return 2;
  if (
    lower.includes("config") ||
    lower.endsWith(".env.example") ||
    lower.includes("vercel.json")
  ) {
    return 3;
  }
  if (
    lower.includes("__tests__") ||
    lower.includes("tests/") ||
    lower.includes("fixtures/") ||
    /\.(?:test|spec)\./.test(lower)
  ) {
    return 5;
  }
  if (lower.includes("lib/") || lower.includes("features/") || lower.includes("components/")) {
    return 4;
  }
  return 6;
}

function byPriority(a: InputFile, b: InputFile): number {
  const priorityDiff = priorityOf(a.path) - priorityOf(b.path);
  return priorityDiff !== 0 ? priorityDiff : a.path.localeCompare(b.path);
}

export function normalizeFiles(
  files: InputFile[],
  config: ScanConfig,
): { files: NormalizedFile[]; omissions: ScanOmission[]; bytes: number; truncated: boolean } {
  const normalized: NormalizedFile[] = [];
  const omissions: ScanOmission[] = [];
  let bytes = 0;
  let truncated = false;

  for (const input of [...files].sort(byPriority)) {
    const path = sanitizePath(input.path);
    if (!path) {
      omissions.push({ path: input.path, reason: "invalid-path" });
      continue;
    }
    const segments = path.split("/");
    if (
      segments.some((segment) => config.ignoredSegments.includes(segment)) ||
      path.startsWith("public/assets/") ||
      path.endsWith(".map") ||
      /\.min\.(?:js|css)$/i.test(path) ||
      /\.generated\.[^.]+$/i.test(path)
    ) {
      omissions.push({ path, reason: "ignored" });
      continue;
    }
    const extension = extensionOf(path);
    if (
      extension === ".md" &&
      !/(?:^|\/)(?:readme|security|auth|configuration|config|deployment|environment)[^/]*\.md$/i.test(path)
    ) {
      omissions.push({ path, reason: "ignored" });
      continue;
    }
    if (
      DEFAULT_BINARY_EXTENSIONS.has(extension) ||
      looksBinary(input.content) ||
      (config.includeExtensions &&
        !config.includeExtensions.includes(extension) &&
        !path.endsWith(".env.example") &&
        !/(?:^|\/)Dockerfile$/i.test(path))
    ) {
      omissions.push({ path, reason: "binary" });
      continue;
    }
    const size = new TextEncoder().encode(input.content).byteLength;
    if (size > config.maxFileBytes) {
      omissions.push({ path, reason: "file-too-large" });
      continue;
    }
    if (normalized.length >= config.maxFiles || bytes + size > config.maxTotalBytes) {
      omissions.push({ path, reason: "total-limit" });
      truncated = true;
      continue;
    }
    const content = input.content.replace(/\r\n?/g, "\n");
    normalized.push({ path, content, lines: content.split("\n"), extension, bytes: size });
    bytes += size;
  }
  return { files: normalized, omissions, bytes, truncated };
}

export function stubNormalizedFile(path: string, content = ""): NormalizedFile {
  const normalized = content.replace(/\r\n?/g, "\n");
  return {
    path,
    content: normalized,
    extension: extensionOf(path),
    lines: normalized.length > 0 ? normalized.split("\n") : [],
    bytes: new TextEncoder().encode(normalized).byteLength,
  };
}
