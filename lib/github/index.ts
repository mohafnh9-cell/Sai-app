/**
 * Phase 31.2: carries the real upstream status so callers can distinguish
 * "GitHub rate-limited us" (429) or "token expired" (401) from a generic
 * failure, instead of every non-ok response reaching the caller as the same
 * untyped Error (which app/api/github/repos/route.ts previously turned into
 * one generic 500 regardless of cause).
 */
export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  language: string | null;
  updated_at: string;
  stargazers_count: number;
  default_branch: string;
}

/**
 * These calls back the GitHub connect / repo-picker UI, which has no
 * equivalent of GitHubRepositoryService's controller-wide timeout -- without
 * one, a hung GitHub response left the user looking at an infinite spinner
 * instead of a controlled error (Phase 13 finding). 15s matches a
 * UI-facing request budget, well under GITHUB_SCAN_LIMITS.timeoutMs (90s,
 * used only for the much larger snapshot/tarball fetch).
 */
const GITHUB_REQUEST_TIMEOUT_MS = 15_000;

function githubFetch(url: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
  });
}

export async function getGitHubRepoById(
  accessToken: string,
  repoId: number
): Promise<GitHubRepo | null> {
  const res = await githubFetch(`https://api.github.com/repositories/${repoId}`, accessToken, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json() as Promise<GitHubRepo>;
}

export async function getGitHubRepos(accessToken: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;

  while (true) {
    const res = await githubFetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      accessToken
    );

    if (!res.ok) {
      throw new GitHubApiError(res.status, `GitHub API returned ${res.status}`);
    }
    const data: GitHubRepo[] = await res.json();
    if (data.length === 0) break;
    repos.push(...data);
    if (data.length < 100) break;
    page++;
  }

  return repos;
}

export async function getGitHubTokenScopes(accessToken: string): Promise<string[]> {
  const res = await githubFetch("https://api.github.com/user", accessToken, { cache: "no-store" });

  if (!res.ok) {
    throw new GitHubApiError(res.status, `GitHub API returned ${res.status}`);
  }

  return (res.headers.get("x-oauth-scopes") ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export async function getGitHubUser(accessToken: string) {
  const res = await githubFetch("https://api.github.com/user", accessToken);
  if (!res.ok) return null;
  return res.json();
}
