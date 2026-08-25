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

// SequrAI's own MCP vulnerability-detection rule source: contains literal
// attack-signature strings (e.g. "eval(", "new Function(") as detection
// patterns and human-readable messages, not an actual MCP server
// implementation. Scanning it as a target self-flags on its own data.
const DETECTOR_SOURCE_PATH = /(?:^|\/)features\/security-analysis\/mcp\//i;

// SequrAI's own first-party MCP OAuth/server implementation. This scanner
// is designed to audit *discovered, third-party* MCP servers bundled in a
// customer's repo for supply-chain risk — its low-precision heuristics
// (any `process.env` read, any `new URL(x)`) aren't meant to gate
// already-reviewed first-party code, and misfire here (e.g. flagging
// redirect-uri.ts, whose entire purpose is validating redirect URIs, for
// "no validation").
const FIRST_PARTY_MCP_IMPLEMENTATION_PATH = /(?:^|\/)server\/mcp\//i;

export function shouldSkipMcpPath(path: string): boolean {
  if (DETECTOR_SOURCE_PATH.test(path) || FIRST_PARTY_MCP_IMPLEMENTATION_PATH.test(path)) {
    return true;
  }
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
