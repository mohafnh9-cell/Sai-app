import "server-only";

import { createGitHubAppJwt } from "./jwt";
import { getGitHubAppConfig } from "./config";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

type CachedInstallationToken = {
  token: string;
  expiresAtMs: number;
};

const tokenCache = new Map<string, CachedInstallationToken>();

export type InstallationAccessToken = {
  token: string;
  expiresAt: string;
};

/**
 * M3 (audit): a cache keyed only by installationId would let a token
 * scoped to one repository set be handed out for a different repository
 * set requested later on the same installation. The scope is part of the
 * cache identity.
 */
function cacheKey(githubInstallationId: number, repositoryIds?: readonly number[]): string {
  if (!repositoryIds || repositoryIds.length === 0) return `${githubInstallationId}:all`;
  return `${githubInstallationId}:${[...repositoryIds].sort((a, b) => a - b).join(",")}`;
}

export function clearInstallationTokenCache(installationId?: number): void {
  if (installationId == null) {
    tokenCache.clear();
    return;
  }
  for (const key of tokenCache.keys()) {
    if (key.startsWith(`${installationId}:`)) tokenCache.delete(key);
  }
}

/**
 * M3 (audit): callers that know which repository (or repositories) a
 * token will actually be used for should pass repositoryIds so the token
 * itself -- not just an app-side ownership check -- is scoped to them.
 * Omitting it returns a token valid for every repository the installation
 * covers; only do that for operations that are genuinely
 * installation-wide (e.g. listing repos to let the user pick which ones
 * to connect), never for fetching a specific repository's content.
 */
export async function fetchInstallationAccessToken(
  githubInstallationId: number,
  options?: { repositoryIds?: readonly number[] }
): Promise<InstallationAccessToken | null> {
  const config = getGitHubAppConfig();
  if (!config) return null;

  const repositoryIds = options?.repositoryIds;
  const key = cacheKey(githubInstallationId, repositoryIds);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return { token: cached.token, expiresAt: new Date(cached.expiresAtMs).toISOString() };
  }

  const jwt = createGitHubAppJwt(config.appId, config.privateKey);
  const response = await fetch(
    `${GITHUB_API}/app/installations/${githubInstallationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "Content-Type": "application/json",
      },
      body:
        repositoryIds && repositoryIds.length > 0
          ? JSON.stringify({ repository_ids: repositoryIds })
          : undefined,
    }
  );

  if (!response.ok) {
    console.warn({
      component: "github-app-token",
      event: "installation_token_failed",
      installationId: githubInstallationId,
      status: response.status,
      scoped: Boolean(repositoryIds && repositoryIds.length > 0),
    });
    tokenCache.delete(key);
    return null;
  }

  const body = (await response.json()) as { token?: string; expires_at?: string };
  if (!body.token || !body.expires_at) return null;

  const expiresAtMs = Date.parse(body.expires_at);
  tokenCache.set(key, {
    token: body.token,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 3_600_000,
  });

  return { token: body.token, expiresAt: body.expires_at };
}
