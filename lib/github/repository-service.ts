import "server-only";

import { Readable } from "node:stream";
import { CRITICAL_FILE_PATTERN, isRelevantPath } from "./path-relevance";
import { extractRepositoryTarball } from "./tarball-extract";
import { SOURCE_ANALYSIS_LIMITS } from "@/lib/upload/source-limits";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

/**
 * fetchSnapshot() downloads a single tarball instead of one blob request per
 * file, so these no longer scale with file count — sized to fit a medium/
 * large repo (see features/security-scanner/config.ts DEFAULT_SCAN_CONFIG,
 * which these are kept in line with) with headroom under the 300s route
 * budget in app/api/repositories/.../scans routes.
 *
 * maxFiles/maxFileBytes/maxTotalBytes/maxDepth come from
 * lib/upload/source-limits.ts, the single canonical definition shared with
 * ZIP upload and Local Analysis (and safe to ship to the client for
 * preflight validation) — not redefined here.
 */
export const GITHUB_SCAN_LIMITS = {
  ...SOURCE_ANALYSIS_LIMITS,
  timeoutMs: 90_000,
  /**
   * fetchCompareSnapshot still fetches one blob per changed file (the
   * compare API has no bulk-content equivalent to the tarball endpoint), so
   * it keeps its own, smaller file cap and concurrency rather than reusing
   * maxFiles — a diff realistically never approaches repo-wide file counts,
   * and each file is still a full HTTP round trip.
   */
  maxCompareFiles: 1_000,
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
      const candidates: Array<{ path: string; sha: string }> = [];
      for (const entry of changedEntries) {
        const path = entry.previous_filename ?? entry.filename;
        const relevance = isRelevantPath(path);
        if (!relevance.include) {
          omissions.push({ path, reason: relevance.reason ?? "unsupported_format" });
          continue;
        }
        const depth = path.split("/").length;
        if (depth > GITHUB_SCAN_LIMITS.maxDepth) {
          omissions.push({ path, reason: "max_depth" });
          continue;
        }
        if (CRITICAL_FILE_PATTERN.test(path)) {
          omissions.push({ path, reason: "critical_file_detected" });
        }
        candidates.push({ path, sha: entry.sha });
      }

      const selected = candidates.slice(0, GITHUB_SCAN_LIMITS.maxCompareFiles);
      if (candidates.length > selected.length) {
        omissions.push({ reason: "max_file_count", count: candidates.length - selected.length });
      }

      const files: RepositoryFile[] = [];
      let totalBytes = 0;
      for (
        let offset = 0;
        offset < selected.length;
        offset += GITHUB_SCAN_LIMITS.fetchConcurrency
      ) {
        if (totalBytes >= GITHUB_SCAN_LIMITS.maxTotalBytes) {
          const remaining = selected.slice(offset);
          omissions.push(
            ...remaining.map((entry) => ({ path: entry.path, reason: "max_total_size" }))
          );
          break;
        }
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

      const tarballStream = await this.fetchTarballStream(ref, commit.sha);
      const { files, totalBytes, omissions } = await extractRepositoryTarball(tarballStream, {
        maxFiles: GITHUB_SCAN_LIMITS.maxFiles,
        maxFileBytes: GITHUB_SCAN_LIMITS.maxFileBytes,
        maxTotalBytes: GITHUB_SCAN_LIMITS.maxTotalBytes,
        maxDepth: GITHUB_SCAN_LIMITS.maxDepth,
      });

      // "critical_file_detected" flags a file for visibility without dropping
      // it (it's still pushed into `files`), so it must not be double-counted
      // as a discovered-but-excluded file here.
      const droppedOmissions = omissions.filter((item) => item.reason !== "critical_file_detected");
      const explicitOmissions = droppedOmissions.filter((item) => item.path != null).length;
      const aggregatedOmissions = droppedOmissions
        .filter((item) => item.path == null)
        .reduce((sum, item) => sum + (item.count ?? 1), 0);

      return {
        repositoryId: repository.id,
        owner: ref.owner,
        repo: ref.repo,
        isPrivate: repository.private,
        defaultBranch: repository.default_branch,
        commitSha: commit.sha,
        files,
        discoveredFiles: files.length + explicitOmissions + aggregatedOmissions,
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
    const response = await this.rawFetchWithRetry(path);
    if (!response.ok) throw this.errorForResponse(response);
    return (await response.json()) as T;
  }

  /**
   * Downloads the tarball for a commit as a Node Readable, following
   * GitHub's redirect to codeload.github.com. Used by fetchSnapshot so a
   * full-repo fetch is one streamed download instead of one request per file.
   */
  private async fetchTarballStream(
    ref: GitHubRepositoryRef,
    commitSha: string
  ): Promise<Readable> {
    const path = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/tarball/${encodeURIComponent(commitSha)}`;
    const response = await this.rawFetchWithRetry(path);
    if (!response.ok) throw this.errorForResponse(response);
    if (!response.body) {
      throw new GitHubServiceError("GITHUB_RESPONSE", "GitHub tarball response had no body", 502);
    }
    return Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
  }

  /**
   * Retries transient failures only (network errors and 5xx responses) --
   * never 401/403/404/429, which are not transient and would just waste the
   * retry budget against an outcome that won't change. Bounded to 2 retries
   * with short backoff so a burst of concurrent scans (Phase 13) doesn't
   * each individually hammer GitHub during a real outage; the overall
   * service-level timeoutMs (90s, via this.controller) still bounds the
   * total time any single retry sequence can take.
   */
  private async rawFetchWithRetry(path: string, attempt = 0): Promise<Response> {
    const maxRetries = 2;
    const backoffMs = 400 * 2 ** attempt;
    try {
      const response = await this.rawFetch(path);
      if (!response.ok && response.status >= 500 && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return this.rawFetchWithRetry(path, attempt + 1);
      }
      return response;
    } catch (error) {
      if (attempt < maxRetries && !this.controller.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return this.rawFetchWithRetry(path, attempt + 1);
      }
      throw error;
    }
  }

  private rawFetch(path: string): Promise<Response> {
    return fetch(`${GITHUB_API}${path}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "SequrAI-Scanner/1.0",
      },
      cache: "no-store",
      signal: this.controller.signal,
      redirect: "follow",
    });
  }

  private errorForResponse(response: Response): GitHubServiceError {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (response.status === 429 || (response.status === 403 && remaining === "0")) {
      return new GitHubServiceError("GITHUB_RATE_LIMIT", "GitHub API rate limit reached", 429);
    }
    if (response.status === 401) {
      return new GitHubServiceError("GITHUB_AUTH", "GitHub authorization has expired", 401);
    }
    if (response.status === 403) {
      return new GitHubServiceError("GITHUB_FORBIDDEN", "GitHub repository access was denied", 403);
    }
    if (response.status === 404) {
      return new GitHubServiceError("GITHUB_NOT_FOUND", "GitHub repository was not found or is inaccessible", 404);
    }
    return new GitHubServiceError("GITHUB_RESPONSE", `GitHub API request failed (${response.status})`, 502);
  }
}
