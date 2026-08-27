import type { Severity } from "./types";

export const DEFAULT_IGNORED_SEGMENTS = [
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  "target",
  ".cache",
  // Static assets served as-is (bundler/esbuild output, service workers, ...).
  // Nobody hand-writes or reviews this file-by-file -- same rationale as dist/build.
  "public",
];

export const DEFAULT_BINARY_EXTENSIONS = new Set([
  ".7z", ".avi", ".bin", ".bmp", ".class", ".dll", ".doc", ".docx", ".exe",
  ".gif", ".gz", ".ico", ".jar", ".jpeg", ".jpg", ".mov", ".mp3", ".mp4",
  ".pdf", ".png", ".so", ".tar", ".woff", ".woff2", ".xls", ".xlsx", ".zip",
]);

export const SOURCE_EXTENSIONS = new Set([
  ".cjs", ".env", ".js", ".json", ".jsx", ".md", ".mjs", ".prisma", ".rules", ".sql",
  ".toml", ".ts", ".tsx", ".yaml", ".yml",
]);

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25,
  high: 15,
  medium: 7,
  low: 2,
  info: 0,
};

export const SECRET_NAME_PATTERN =
  /(?:api[_-]?key|secret|token|password|passwd|private[_-]?key|client[_-]?secret|access[_-]?key)/i;

export const CLIENT_ENV_PREFIX_PATTERN = /^(?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_)/;
