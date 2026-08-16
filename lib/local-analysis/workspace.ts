import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

export class WorkspaceBoundaryError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "WorkspaceBoundaryError";
    this.code = code;
  }
}

export type LocalWorkspaceFile = {
  relativePath: string;
  absolutePath: string;
  size: number;
};

export const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  "target",
  ".cache",
  ".turbo",
  ".vercel",
]);

/** Aligned with lib/github/repository-service.ts GITHUB_SCAN_LIMITS. */
export const LOCAL_SCAN_LIMITS = {
  maxFiles: 200,
  maxFileBytes: 256_000,
  maxTotalBytes: 5_000_000,
  maxDepth: 18,
} as const;

export const MAX_FILE_BYTES = LOCAL_SCAN_LIMITS.maxFileBytes;
export const MAX_TOTAL_BYTES = LOCAL_SCAN_LIMITS.maxTotalBytes;
export const MAX_FILES = LOCAL_SCAN_LIMITS.maxFiles;
export const MAX_DEPTH = LOCAL_SCAN_LIMITS.maxDepth;

const CREDENTIAL_BASENAME_PATTERNS = [
  /^\.env$/i,
  /^\.env\.(?!example$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /credentials/i,
  /secrets?/i,
  /service-account.*\.json$/i,
] as const;

export function isCredentialDeniedBasename(name: string): boolean {
  const base = basename(name);
  return CREDENTIAL_BASENAME_PATTERNS.some((pattern) => pattern.test(base));
}

function decodePathSegment(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

export function normalizeWorkspaceRoot(input?: string): string {
  const root = resolve(input ?? process.cwd());
  if (!existsSync(root)) {
    throw new WorkspaceBoundaryError("workspace_not_found");
  }
  const stat = lstatSync(root);
  if (!stat.isDirectory()) {
    throw new WorkspaceBoundaryError("workspace_not_directory");
  }
  return root;
}

function realpathResolved(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      const parent = dirname(path);
      if (parent === path) {
        throw new WorkspaceBoundaryError("workspace_not_found");
      }
      return resolve(realpathResolved(parent), basename(path));
    }
    throw error;
  }
}

function isDescendantPath(root: string, target: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root.slice(0, -1) : root;
  const normalizedTarget = target.endsWith(sep) ? target.slice(0, -1) : target;
  if (normalizedTarget === normalizedRoot) return true;
  return normalizedTarget.startsWith(`${normalizedRoot}${sep}`);
}

/**
 * Resolve a client-requested workspace path against an explicitly authorized root.
 * Fails closed on traversal, encoded traversal, absolute paths outside root, and symlink escapes.
 */
export function resolveAuthorizedWorkspacePath(
  authorizedRoot: string,
  requestedPath?: string | null
): string {
  const root = normalizeWorkspaceRoot(authorizedRoot);
  const rootReal = realpathResolved(root);

  if (!requestedPath?.trim()) {
    return rootReal;
  }

  const decoded = decodePathSegment(requestedPath.trim());
  if (decoded.includes("\0")) {
    throw new WorkspaceBoundaryError("workspace_path_not_authorized");
  }

  const segments = decoded.split(/[/\\]+/).filter(Boolean);
  for (const segment of segments) {
    assertPathComponentSafe(segment);
  }

  const isAbsolute = decoded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(decoded);
  const candidate = isAbsolute ? resolve(decoded) : resolve(rootReal, decoded);
  const candidateReal = realpathResolved(candidate);

  if (!isDescendantPath(rootReal, candidateReal)) {
    throw new WorkspaceBoundaryError("workspace_path_not_authorized");
  }

  if (!existsSync(candidateReal)) {
    throw new WorkspaceBoundaryError("workspace_not_found");
  }

  const stat = lstatSync(candidateReal);
  if (!stat.isDirectory()) {
    throw new WorkspaceBoundaryError("workspace_not_directory");
  }

  return candidateReal;
}

function assertPathComponentSafe(component: string) {
  const decoded = decodePathSegment(component);
  if (
    decoded === ".." ||
    decoded.includes("\0") ||
    decoded.includes("/") ||
    decoded.includes("\\")
  ) {
    throw new WorkspaceBoundaryError("workspace_path_not_authorized");
  }
}

export function resolveSafePath(workspaceRoot: string, candidatePath?: string): string {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  if (!candidatePath) return root;

  const decoded = decodePathSegment(candidatePath);
  const segments = decoded.split(/[/\\]+/).filter(Boolean);
  for (const segment of segments) {
    assertPathComponentSafe(segment);
  }

  const target = resolve(root, ...segments);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new WorkspaceBoundaryError("workspace_path_not_authorized");
  }

  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      throw new Error("symlink_not_allowed");
    }
  }

  return target;
}

function parseIgnoreLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function loadIgnorePatterns(workspaceRoot: string): string[] {
  const patterns: string[] = [];
  for (const fileName of [".gitignore", ".sequraiignore"]) {
    const filePath = resolveSafePath(workspaceRoot, fileName);
    if (!existsSync(filePath)) continue;
    patterns.push(...parseIgnoreLines(readFileSync(filePath, "utf8")));
  }
  return patterns;
}

function pathMatchesPattern(relativePath: string, pattern: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (pattern.endsWith("/")) {
    return normalized.split("/").includes(pattern.slice(0, -1));
  }
  if (pattern.includes("*")) {
    const regex = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*")}$`
    );
    return regex.test(normalized);
  }
  return normalized === pattern || normalized.endsWith(`/${pattern}`);
}

export function isIgnoredRelativePath(relativePath: string, workspaceRoot: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const firstSegment = normalized.split("/")[0];
  if (DEFAULT_IGNORED_DIRS.has(firstSegment)) {
    return true;
  }
  if (isCredentialDeniedBasename(normalized)) {
    return true;
  }
  for (const pattern of loadIgnorePatterns(workspaceRoot)) {
    if (pathMatchesPattern(normalized, pattern)) {
      return true;
    }
  }
  return false;
}

export type WorkspaceListingStats = {
  filesExcluded: number;
  credentialsSkipped: number;
  discoveredFiles: number;
};

export type WorkspaceListing = {
  files: LocalWorkspaceFile[];
  totalBytes: number;
  truncated: boolean;
  stats: WorkspaceListingStats;
};

export function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

export function listWorkspaceFiles(
  workspaceRoot: string,
  options: {
    maxFiles?: number;
    maxFileBytes?: number;
    maxTotalBytes?: number;
    maxDepth?: number;
    onlyRelativePaths?: Set<string>;
  } = {}
): WorkspaceListing {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const files: LocalWorkspaceFile[] = [];
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  let totalBytes = 0;
  let filesExcluded = 0;
  let credentialsSkipped = 0;
  let discoveredFiles = 0;
  let truncated = false;

  function recordExcluded(relativePath: string) {
    filesExcluded += 1;
    if (isCredentialDeniedBasename(relativePath)) {
      credentialsSkipped += 1;
    }
  }

  function walk(currentDir: string, depth: number) {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    if (depth > maxDepth) {
      truncated = true;
      filesExcluded += 1;
      return;
    }

    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }

      const absolutePath = resolve(currentDir, entry.name);
      const rel = relative(root, absolutePath).replace(/\\/g, "/");
      if (!rel || rel.startsWith("..")) continue;

      if (entry.isSymbolicLink()) {
        filesExcluded += 1;
        continue;
      }

      if (entry.isDirectory()) {
        if (isIgnoredRelativePath(`${rel}/`, root)) {
          recordExcluded(`${rel}/`);
          continue;
        }
        walk(absolutePath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      discoveredFiles += 1;

      if (isIgnoredRelativePath(rel, root)) {
        recordExcluded(rel);
        continue;
      }
      if (options.onlyRelativePaths && !options.onlyRelativePaths.has(rel)) {
        continue;
      }

      let stat;
      try {
        stat = lstatSync(absolutePath);
      } catch {
        filesExcluded += 1;
        continue;
      }
      if (stat.isSymbolicLink()) {
        filesExcluded += 1;
        continue;
      }
      if (stat.size > maxFileBytes) {
        filesExcluded += 1;
        truncated = true;
        continue;
      }

      if (totalBytes + stat.size > maxTotalBytes) {
        truncated = true;
        break;
      }

      totalBytes += stat.size;
      files.push({ relativePath: rel, absolutePath, size: stat.size });
    }
  }

  walk(root, 0);

  return {
    files,
    totalBytes,
    truncated,
    stats: {
      filesExcluded,
      credentialsSkipped,
      discoveredFiles,
    },
  };
}

export function readWorkspaceTextFile(workspaceRoot: string, relativePath: string): string {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const safePath = resolveSafePath(root, relativePath);
  if (!existsSync(safePath) || !lstatSync(safePath).isFile()) {
    throw new Error("file_not_found");
  }
  const buffer = readFileSync(safePath);
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error("file_too_large");
  }
  if (isBinaryBuffer(buffer)) {
    throw new Error("binary_file");
  }
  return buffer.toString("utf8");
}
