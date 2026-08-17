import "server-only";

import {
  DEFAULT_BINARY_EXTENSIONS,
  DEFAULT_IGNORED_SEGMENTS,
  SOURCE_EXTENSIONS,
} from "@/features/security-scanner/constants";
import { extensionOf, sanitizePath } from "@/features/security-scanner/path";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export const GITHUB_SCAN_LIMITS = {
  maxFiles: 200,
  maxFileBytes: 256_000,
  maxTotalBytes: 5_000_000,
  maxDepth: 18,
  timeoutMs: 25_000,
  fetchConcurrency: 8,
} as const;

export type GitHubRepositoryRef = { owner: string; repo: string };
export { parseGitHubRepository, type GitHubRepositoryReference } from "./repository-reference";
import { parseGitHubRepository } from "./repository-reference";
export type RepositoryFile = { path: string; content: string; size: number; sha: string };
export type RepositorySnapshot = {
  repositoryId: number;
  owner: string;
  repo: string;
  isPrivate: boolean;
  defaultBranch: string;
  commitSha: string;
  files: RepositoryFile[];
  discoveredFiles: number;
  totalBytes: number;
  omissions: Array<{ path?: string; reason: string; count?: number }>;
  changedPaths?: string[];
  baseCommitSha?: string;
};

const CRITICAL_FILE_PATTERN =
  /(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|next\.config\.(?:js|mjs|ts)|middleware\.(?:js|ts)|auth\.(?:js|ts)|prisma\/schema\.prisma)$/i;

export class GitHubServiceError extends Error {
  constructor(
    public readonly code:
      | "GITHUB_AUTH"
      | "GITHUB_FORBIDDEN"
      | "GITHUB_NOT_FOUND"
      | "GITHUB_RATE_LIMIT"
      | "GITHUB_TIMEOUT"
      | "GITHUB_RESPONSE",
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "GitHubServiceError";
  }
}

type GitHubRepo = {
  id: number;
  private: boolean;
  default_branch: string;
  full_name: string;
};
type GitHubCommit = { sha: string; commit: { tree: { sha: string } } };
type GitHubTree = {
  truncated: boolean;
  tree: Array<{ path: string; mode: string; type: "blob" | "tree" | "commit"; sha: string; size?: number }>;
};
type GitHubBlob = { encoding: "base64" | "utf-8"; content: string; size: number; sha: string };
type GitHubCompareFile = {
  filename: string;
  previous_filename?: string;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";
  sha: string | null;
  additions: number;
  deletions: number;
};
type GitHubCompare = {
  status: string;
  ahead_by: number;
  behind_by: number;
  files?: GitHubCompareFile[];
  commits: Array<{ sha: string }>;
};

function isRelevantPath(path: string): { include: boolean; reason?: string } {
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

export type ResolvedCommitReference = { sha: string; branch: string | null };

/**
 * Lightweight commit lookup used by review_now to resolve which commit will
 * be reviewed — either an explicit, authorized commitSha or the latest
 * commit on a branch (default branch when none is given). This never fetches
 * file contents; it exists purely for commit resolution, independent of the
 * (heavier) full-repository snapshot used by the scanner itself.
 */
export async function resolveCommitReference(
  accessToken: string,
  ref: GitHubRepositoryRef,
  input: { commitSha?: string; branch?: string }
): Promise<ResolvedCommitReference> {
  const service = new GitHubRepositoryService(accessToken);
  try {
    return await service.resolveCommitReference(ref, input);
  } finally {
    service.dispose();
  }
}

export type FetchSnapshotOptions = {
  branch?: string;
  /** When set, file tree is loaded at this commit (not branch tip). */
  commitSha?: string;
};

function normalizeFetchSnapshotOptions(
  requestedBranchOrOptions?: string | FetchSnapshotOptions
): FetchSnapshotOptions {
  if (typeof requestedBranchOrOptions === "string") {
    return { branch: requestedBranchOrOptions };
  }
  return requestedBranchOrOptions ?? {};
}

export class GitHubRepositoryService {
  private readonly controller = new AbortController();
  private readonly deadline: ReturnType<typeof setTimeout>;
  private readonly requestCache = new Map<string, Promise<unknown>>();
  private disposed = false;

  constructor(private readonly accessToken: string) {
    if (!accessToken) throw new Error("GitHub access token is required");
    this.deadline = setTimeout(() => this.controller.abort(), GITHUB_SCAN_LIMITS.timeoutMs);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.deadline);
    this.requestCache.clear();
  }

  async resolveCommitReference(
    ref: GitHubRepositoryRef,
    input: { commitSha?: string; branch?: string }
  ): Promise<ResolvedCommitReference> {
    const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;

    try {
      if (input.commitSha?.trim()) {
        const commit = await this.request<{ sha: string }>(
          `${base}/commits/${encodeURIComponent(input.commitSha.trim())}`
        );
        return { sha: commit.sha, branch: input.branch?.trim() || null };
      }

      const repository = await this.request<GitHubRepo>(base);
      const branch = input.branch?.trim() || repository.default_branch;
      const commit = await this.request<{ sha: string }>(
        `${base}/commits/${encodeURIComponent(branch)}`
      );
      return { sha: commit.sha, branch };
    } catch (error) {
      if (error instanceof GitHubServiceError) throw error;
      if (this.controller.signal.aborted) {
        throw new GitHubServiceError("GITHUB_TIMEOUT", "GitHub commit lookup timed out", 504);
      }
      throw error;
    }
  }

  async fetchCompareSnapshot(
    ref: GitHubRepositoryRef,
    baseSha: string,
    headSha: string
  ): Promise<RepositorySnapshot> {
    try {
      const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
      const repository = await this.request<GitHubRepo>(base);
      const compare = await this.request<{
        files?: Array<{
          filename: string;
          status: string;
          sha: string;
          previous_filename?: string;
        }>;
      }>(`${base}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`);

      const changedEntries =
        compare.files?.filter((file) =>
          ["added", "modified", "renamed", "changed"].includes(file.status)
        ) ?? [];

      const changedPaths = changedEntries.map(
        (file) => file.previous_filename ?? file.filename
      );
      const omissions: RepositorySnapshot["omissions"] = [];
      const files: RepositoryFile[] = [];
      let totalBytes = 0;

      for (const entry of changedEntries) {
        const path = entry.previous_filename ?? entry.filename;
        const relevance = isRelevantPath(path);
        if (!relevance.include) {
          omissions.push({ path, reason: relevance.reason ?? "unsupported_format" });
          continue;
        }
        if (CRITICAL_FILE_PATTERN.test(path)) {
          omissions.push({ path, reason: "critical_file_detected" });
        }
        const blob = await this.request<GitHubBlob>(
          `${base}/git/blobs/${encodeURIComponent(entry.sha)}`
        );
        if (blob.size > GITHUB_SCAN_LIMITS.maxFileBytes) {
          omissions.push({ path, reason: "max_file_size" });
          continue;
        }
        const bytes = Buffer.from(
          blob.content.replace(/\s/g, ""),
          blob.encoding === "base64" ? "base64" : "utf8"
        );
        if (bytes.includes(0)) {
          omissions.push({ path, reason: "binary_file" });
          continue;
        }
        files.push({
          path,
          content: bytes.toString("utf8"),
          size: bytes.byteLength,
          sha: blob.sha,
        });
        totalBytes += bytes.byteLength;
      }

      return {
        repositoryId: repository.id,
        owner: ref.owner,
        repo: ref.repo,
        isPrivate: repository.private,
        defaultBranch: repository.default_branch,
        commitSha: headSha,
        files,
        discoveredFiles: changedPaths.length,
        totalBytes,
        omissions,
        changedPaths,
        baseCommitSha: baseSha,
      };
    } catch (error) {
      if (error instanceof GitHubServiceError) throw error;
      if (this.controller.signal.aborted) {
        throw new GitHubServiceError("GITHUB_TIMEOUT", "GitHub compare fetch timed out", 504);
      }
      throw error;
    }
  }

  async fetchSnapshot(
    ref: GitHubRepositoryRef,
    requestedBranchOrOptions?: string | FetchSnapshotOptions
  ): Promise<RepositorySnapshot> {
    try {
      const options = normalizeFetchSnapshotOptions(requestedBranchOrOptions);
      const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
      const repository = await this.request<GitHubRepo>(base);
      const branch = options.branch?.trim() || repository.default_branch;
      const commitRef = options.commitSha?.trim() || branch;
      const commit = await this.request<GitHubCommit>(
        `${base}/commits/${encodeURIComponent(commitRef)}`
      );
      const tree = await this.request<GitHubTree>(
        `${base}/git/trees/${encodeURIComponent(commit.commit.tree.sha)}?recursive=1`
      );

      const omissions: RepositorySnapshot["omissions"] = [];
      if (tree.truncated) omissions.push({ reason: "github_tree_truncated" });

      const blobs = tree.tree.filter((entry) => entry.type === "blob");
      const candidates = blobs.filter((entry) => {
        const relevance = isRelevantPath(entry.path);
        if (!relevance.include) {
          omissions.push({ path: entry.path, reason: relevance.reason ?? "unsupported_format" });
          return false;
        }
        const depth = entry.path.split("/").length;
        if (depth > GITHUB_SCAN_LIMITS.maxDepth) {
          omissions.push({ path: entry.path, reason: "max_depth" });
          return false;
        }
        if ((entry.size ?? 0) > GITHUB_SCAN_LIMITS.maxFileBytes) {
          omissions.push({ path: entry.path, reason: "max_file_size" });
          return false;
        }
        return true;
      });

      const selected: typeof candidates = [];
      let selectedBytes = 0;
      for (const entry of candidates) {
        if (selected.length >= GITHUB_SCAN_LIMITS.maxFiles) break;
        const size = entry.size ?? 0;
        if (selectedBytes + size > GITHUB_SCAN_LIMITS.maxTotalBytes) {
          omissions.push({ path: entry.path, reason: "max_total_size" });
          continue;
        }
        selected.push(entry);
        selectedBytes += size;
      }
      if (candidates.length > selected.length) {
        omissions.push({
          reason: "max_file_count",
          count: candidates.length - selected.length,
        });
      }

      const files: RepositoryFile[] = [];
      let totalBytes = 0;
      for (let offset = 0; offset < selected.length; offset += GITHUB_SCAN_LIMITS.fetchConcurrency) {
        const batch = selected.slice(offset, offset + GITHUB_SCAN_LIMITS.fetchConcurrency);
        const fetched = await Promise.all(
          batch.map(async (entry) => ({
            entry,
            blob: await this.request<GitHubBlob>(
              `${base}/git/blobs/${encodeURIComponent(entry.sha)}`
            ),
          }))
        );
        for (const { entry, blob } of fetched) {
          if (blob.size > GITHUB_SCAN_LIMITS.maxFileBytes) {
            omissions.push({ path: entry.path, reason: "max_file_size" });
            continue;
          }
          const bytes = Buffer.from(
            blob.content.replace(/\s/g, ""),
            blob.encoding === "base64" ? "base64" : "utf8"
          );
          if (bytes.includes(0)) {
            omissions.push({ path: entry.path, reason: "binary_file" });
            continue;
          }
          if (totalBytes + bytes.byteLength > GITHUB_SCAN_LIMITS.maxTotalBytes) {
            omissions.push({ path: entry.path, reason: "max_total_size" });
            continue;
          }
          files.push({
            path: entry.path,
            content: bytes.toString("utf8"),
            size: bytes.byteLength,
            sha: blob.sha,
          });
          totalBytes += bytes.byteLength;
        }
      }

      return {
        repositoryId: repository.id,
        owner: ref.owner,
        repo: ref.repo,
        isPrivate: repository.private,
        defaultBranch: repository.default_branch,
        commitSha: commit.sha,
        files,
        discoveredFiles: blobs.length,
        totalBytes,
        omissions,
      };
    } catch (error) {
      if (error instanceof GitHubServiceError) throw error;
      if (this.controller.signal.aborted) {
        throw new GitHubServiceError("GITHUB_TIMEOUT", "GitHub repository fetch timed out", 504);
      }
      throw error;
    }
  }

  private async request<T>(path: string): Promise<T> {
    const cached = this.requestCache.get(path);
    if (cached) {
      return cached as Promise<T>;
    }

    const pending = this.fetchRequest<T>(path);
    this.requestCache.set(path, pending);
    try {
      return await pending;
    } catch (error) {
      this.requestCache.delete(path);
      throw error;
    }
  }

  private async fetchRequest<T>(path: string): Promise<T> {
    const response = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "SequrAI-Scanner/1.0",
      },
      cache: "no-store",
      signal: this.controller.signal,
    });
    if (!response.ok) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (response.status === 429 || (response.status === 403 && remaining === "0")) {
        throw new GitHubServiceError("GITHUB_RATE_LIMIT", "GitHub API rate limit reached", 429);
      }
      if (response.status === 401) {
        throw new GitHubServiceError("GITHUB_AUTH", "GitHub authorization has expired", 401);
      }
      if (response.status === 403) {
        throw new GitHubServiceError("GITHUB_FORBIDDEN", "GitHub repository access was denied", 403);
      }
      if (response.status === 404) {
        throw new GitHubServiceError("GITHUB_NOT_FOUND", "GitHub repository was not found or is inaccessible", 404);
      }
      throw new GitHubServiceError("GITHUB_RESPONSE", `GitHub API request failed (${response.status})`, 502);
    }
    return (await response.json()) as T;
  }
}
