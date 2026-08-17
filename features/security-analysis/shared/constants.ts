export const SCAN_SKIP_DIR_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  "venv",
  ".venv",
  "coverage",
  ".next",
  ".nuxt",
]);

export function shouldSkipScanPath(path: string, skipDirs: Set<string> = SCAN_SKIP_DIR_SEGMENTS): boolean {
  return path.split("/").some((segment) => skipDirs.has(segment));
}
