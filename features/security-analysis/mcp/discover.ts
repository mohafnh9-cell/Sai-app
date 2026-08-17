import {
  MCP_BASELINE_FILENAME,
  MCP_CONTENT_INDICATORS,
  MCP_MANIFEST_FILENAME,
  MCP_SCANNABLE_EXTENSIONS,
  MCP_SKIP_DIR_SEGMENTS,
} from "./constants";
import type { McpScanTarget } from "./types";

export type RepositoryFile = {
  path: string;
  content: string;
};

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function extension(path: string): string {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

export function shouldSkipMcpPath(path: string): boolean {
  return path.split("/").some((segment) => MCP_SKIP_DIR_SEGMENTS.has(segment));
}

function isScannableSource(path: string): boolean {
  return MCP_SCANNABLE_EXTENSIONS.has(extension(path));
}

function isMcpRelatedPath(path: string): boolean {
  return /(?:^|\/)mcp(?:\/|$)/i.test(path) || /mcp-server/i.test(path);
}

function hasMcpServerContent(content: string): boolean {
  return MCP_CONTENT_INDICATORS.some((pattern) => pattern.test(content));
}

export function discoverMcpTargets(files: RepositoryFile[]): McpScanTarget {
  const sourceFiles: RepositoryFile[] = [];
  const manifestFiles: RepositoryFile[] = [];
  const baselineFiles: RepositoryFile[] = [];
  const manifestDirs = new Set<string>();
  const seenSourcePaths = new Set<string>();

  for (const file of files) {
    if (shouldSkipMcpPath(file.path)) continue;
    const name = basename(file.path);
    if (name === MCP_MANIFEST_FILENAME) {
      manifestFiles.push(file);
      manifestDirs.add(dirname(file.path));
    }
    if (name === MCP_BASELINE_FILENAME) {
      baselineFiles.push(file);
    }
  }

  for (const file of files) {
    if (shouldSkipMcpPath(file.path)) continue;
    if (!isScannableSource(file.path)) continue;

    const dir = dirname(file.path);
    const nearManifest = manifestDirs.has(dir);
    const mcpPath = isMcpRelatedPath(file.path);
    const mcpContent = hasMcpServerContent(file.content);

    if (nearManifest || mcpPath || mcpContent) {
      if (!seenSourcePaths.has(file.path)) {
        seenSourcePaths.add(file.path);
        sourceFiles.push(file);
      }
    }
  }

  return { sourceFiles, manifestFiles, baselineFiles };
}

export function findBaselineForManifest(
  manifestPath: string,
  baselineFiles: RepositoryFile[]
): RepositoryFile | undefined {
  const dir = dirname(manifestPath);
  return baselineFiles.find((file) => dirname(file.path) === dir);
}
