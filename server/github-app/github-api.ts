import "server-only";

import { createGitHubAppJwt } from "./jwt";
import { getGitHubAppConfig } from "./config";
import { fetchInstallationAccessToken } from "./installation-token-service";
import { GITHUB_APP_TARGET_PERMISSIONS } from "@/server/github/github-auth-mode";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export type GitHubApiInstallation = {
  id: number;
  account: {
    id: number;
    login: string;
    type: "User" | "Organization";
  };
  repository_selection: "all" | "selected";
  permissions: Record<string, string>;
  suspended_at: string | null;
};

function appHeaders(jwt: string) {
  return {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

export async function fetchGitHubInstallation(
  githubInstallationId: number
): Promise<GitHubApiInstallation | null> {
  const config = getGitHubAppConfig();
  if (!config) return null;

  const jwt = createGitHubAppJwt(config.appId, config.privateKey);
  const response = await fetch(`${GITHUB_API}/app/installations/${githubInstallationId}`, {
    headers: appHeaders(jwt),
    cache: "no-store",
  });

  if (!response.ok) return null;
  return response.json() as Promise<GitHubApiInstallation>;
}

export type GitHubInstallationRepo = {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  description: string | null;
  language: string | null;
  updated_at: string;
  stargazers_count: number;
};

export async function listInstallationRepositories(
  githubInstallationId: number
): Promise<GitHubInstallationRepo[]> {
  const installationToken = await fetchInstallationAccessToken(githubInstallationId);
  if (!installationToken) return [];

  const headers = {
    Authorization: `Bearer ${installationToken.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
  const repos: GitHubInstallationRepo[] = [];
  let page = 1;

  while (page <= 10) {
    const response = await fetch(
      `${GITHUB_API}/installation/repositories?per_page=100&page=${page}`,
      { headers, cache: "no-store" }
    );
    if (!response.ok) break;

    const body = (await response.json()) as {
      repositories?: GitHubInstallationRepo[];
    };
    const batch = body.repositories ?? [];
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return repos;
}

export async function verifyRepositoryInInstallation(
  githubInstallationId: number,
  githubRepositoryId: number
): Promise<boolean> {
  const repos = await listInstallationRepositories(githubInstallationId);
  return repos.some((repo) => repo.id === githubRepositoryId);
}

export function validateInstallationPermissions(
  permissions: Record<string, string>
): { ok: true } | { ok: false; missing: string[] } {
  const required = Object.entries(GITHUB_APP_TARGET_PERMISSIONS) as Array<[string, string]>;
  const missing: string[] = [];

  for (const [key, level] of required) {
    const granted = permissions[key];
    if (!granted) {
      missing.push(`${key}:${level}`);
      continue;
    }
    if (level === "write" && granted !== "write") {
      missing.push(`${key}:write`);
    }
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
