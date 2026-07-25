import type { GitHubRepo } from "@/lib/github";

/** Parsed GitHub repository identity used for API calls and storage normalization. */
export type GitHubRepositoryRef = { owner: string; repo: string };

export type GitHubRepositoryReference = GitHubRepositoryRef & {
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
};

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function assertOwnerRepo(owner: string, repo: string): GitHubRepositoryRef {
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) {
    throw new Error("GitHub repository must be in owner/repository format");
  }
  return { owner, repo };
}

/**
 * Normalizes a repository path segment list. Repairs the known malformed pattern
 * `{owner}/{owner}/{repository}` → `{owner}/{repository}`.
 */
export function normalizeRepositoryPathParts(parts: string[]): GitHubRepositoryRef {
  const segments = parts.filter(Boolean);
  if (segments.length === 2) {
    return assertOwnerRepo(segments[0], segments[1]);
  }
  if (segments.length === 3 && segments[0] === segments[1]) {
    return assertOwnerRepo(segments[0], segments[2]);
  }
  throw new Error("GitHub repository must be in owner/repository format");
}

export function toGitHubHtmlUrl(ref: GitHubRepositoryRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}`;
}

export function toGitHubCloneUrl(ref: GitHubRepositoryRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}.git`;
}

export function toGitHubFullName(ref: GitHubRepositoryRef): string {
  return `${ref.owner}/${ref.repo}`;
}

export function gitHubRepositoryReferenceFromRef(ref: GitHubRepositoryRef): GitHubRepositoryReference {
  return {
    ...ref,
    fullName: toGitHubFullName(ref),
    htmlUrl: toGitHubHtmlUrl(ref),
    cloneUrl: toGitHubCloneUrl(ref),
  };
}

/** Prefer GitHub API `html_url`; never reconstruct from owner + full_name. */
export function gitHubRepositoryReferenceFromApi(repo: Pick<GitHubRepo, "full_name" | "html_url">): GitHubRepositoryReference {
  const ref = parseGitHubRepository(repo.full_name);
  const htmlUrl = normalizeGitHubHtmlUrl(repo.html_url) ?? toGitHubHtmlUrl(ref);
  return {
    ...ref,
    fullName: toGitHubFullName(ref),
    htmlUrl,
    cloneUrl: toGitHubCloneUrl(ref),
  };
}

export function normalizeGitHubHtmlUrl(value: string): string | null {
  try {
    const ref = parseGitHubRepository(value);
    return toGitHubHtmlUrl(ref);
  } catch {
    return null;
  }
}

/**
 * Canonical value persisted in `projects.github_repo` (GitHub `html_url` form).
 */
export function normalizeStoredGitHubRepository(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const ref = parseGitHubRepository(trimmed);
  return toGitHubHtmlUrl(ref);
}

export function parseGitHubRepository(value: string): GitHubRepositoryRef {
  const trimmed = value.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  let path = trimmed;

  if (trimmed.startsWith("git@github.com:")) {
    path = trimmed.slice("git@github.com:".length);
  } else if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error("Invalid GitHub repository");
    }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
      throw new Error("Repository must be hosted on github.com");
    }
    path = url.pathname;
  }

  const parts = path.split("/").filter(Boolean);
  return normalizeRepositoryPathParts(parts);
}

export function repositoryLookupKeys(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const ref = parseGitHubRepository(value);
    const canonical = toGitHubHtmlUrl(ref);
    const fullName = toGitHubFullName(ref);
    return [...new Set([value.trim(), canonical, fullName])];
  } catch {
    return [value.trim()];
  }
}

export function repositorySelectorMatchesStored(selector: string, stored: string | null): boolean {
  if (!stored) return false;
  const selectorKeys = new Set(repositoryLookupKeys(selector));
  return repositoryLookupKeys(stored).some((key) => selectorKeys.has(key));
}

export function isMalformedDoubleOwnerGitHubUrl(value: string): boolean {
  try {
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) return false;
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() !== "github.com") return false;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length === 3 && parts[0] === parts[1];
  } catch {
    return false;
  }
}
