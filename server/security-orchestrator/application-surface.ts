import "server-only";

import { detectStack } from "@/features/security-scanner/stack";
import type { NormalizedFile } from "@/features/security-scanner/types";
import type { ApplicationSurface } from "./types";

const DOCKERFILE_PATTERN = /(^|\/)Dockerfile(\.[a-zA-Z0-9_-]+)?$/;
const IAC_PATTERN = /\.tf$|(^|\/)(k8s|kubernetes)\/.*\.ya?ml$/i;
const GITHUB_ACTIONS_PATTERN = /^\.github\/workflows\/.*\.ya?ml$/;
const MCP_INDICATOR_PATTERN = /@modelcontextprotocol|McpServer|server\.tool\(/;
const DEPENDENCY_MANIFESTS = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "requirements.txt",
  "poetry.lock",
  "Cargo.lock",
  "go.sum",
  "Gemfile.lock",
];

/**
 * Section 6: builds the canonical ApplicationSurface by REUSING
 * detectStack() (features/security-scanner/stack.ts, already the source of
 * truth for languages/frameworks/services) rather than re-deriving that
 * logic. The extra booleans here exist only for plan explainability
 * (section 5's "Application: Next.js / TypeScript / Supabase / Docker..."
 * example) -- the actual engine SELECTION logic in planner.ts calls each
 * engine's own applicability() (Phase 35), never re-implements it.
 */
export function buildApplicationSurface(input: {
  files: Array<{ path: string; content: string }>;
  githubRepo: string | null;
}): ApplicationSurface {
  const normalized: NormalizedFile[] = input.files.map((f) => ({
    path: f.path,
    content: f.content,
    extension: f.path.slice(f.path.lastIndexOf(".")),
    lines: f.content.split("\n"),
    bytes: f.content.length,
  }));

  const stack = detectStack(normalized);

  return {
    stack,
    hasDockerfile: input.files.some((f) => DOCKERFILE_PATTERN.test(f.path)),
    hasIacFiles: input.files.some((f) => IAC_PATTERN.test(f.path)),
    hasGithubActions: input.files.some((f) => GITHUB_ACTIONS_PATTERN.test(f.path)),
    hasMcpIndicators: input.files.some((f) => MCP_INDICATOR_PATTERN.test(f.content)),
    hasDependencyManifest: input.files.some((f) => DEPENDENCY_MANIFESTS.some((m) => f.path.endsWith(m))),
    githubRepo: input.githubRepo,
    fileCount: input.files.length,
  };
}
