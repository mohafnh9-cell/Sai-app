import {
  DEFAULT_BINARY_EXTENSIONS,
  DEFAULT_IGNORED_SEGMENTS,
  SOURCE_EXTENSIONS,
} from "@/features/security-scanner/constants";
import { extensionOf, sanitizePath } from "@/features/security-scanner/path";

export const CRITICAL_FILE_PATTERN =
  /(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|next\.config\.(?:js|mjs|ts)|middleware\.(?:js|ts)|auth\.(?:js|ts)|prisma\/schema\.prisma)$/i;

export function isRelevantPath(path: string): { include: boolean; reason?: string } {
  const safe = sanitizePath(path);
  if (!safe) return { include: false, reason: "invalid_path" };
  const segments = safe.split("/");
  if (
    segments.some((segment) => DEFAULT_IGNORED_SEGMENTS.includes(segment)) ||
    safe.startsWith("target/") ||
    safe.startsWith(".cache/") ||
    safe.startsWith("public/assets/")
  ) {
    return { include: false, reason: "ignored_path" };
  }
  const extension = extensionOf(safe);
  if (
    extension === ".md" &&
    !/(?:^|\/)(?:readme|security|auth|configuration|config|deployment|environment)[^/]*\.md$/i.test(safe)
  ) {
    return { include: false, reason: "irrelevant_markdown" };
  }
  if (DEFAULT_BINARY_EXTENSIONS.has(extension)) {
    return { include: false, reason: "binary_extension" };
  }
  if (
    safe.endsWith(".map") ||
    /\.min\.(?:js|css)$/i.test(safe) ||
    /\.generated\.[^.]+$/i.test(safe)
  ) {
    return { include: false, reason: "generated_file" };
  }
  if (safe.endsWith(".env.example")) return { include: true };
  if (/(?:^|\/)Dockerfile$/i.test(safe)) return { include: true };
  if (!SOURCE_EXTENSIONS.has(extension)) {
    return { include: false, reason: "unsupported_format" };
  }
  return { include: true };
}
