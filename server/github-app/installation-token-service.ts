import "server-only";

import { createGitHubAppJwt } from "./jwt";
import { getGitHubAppConfig } from "./config";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

type CachedInstallationToken = {
  token: string;
  expiresAtMs: number;
};

const tokenCache = new Map<number, CachedInstallationToken>();

export type InstallationAccessToken = {
  token: string;
  expiresAt: string;
};

export function clearInstallationTokenCache(installationId?: number): void {
  if (installationId == null) {
    tokenCache.clear();
    return;
  }
  tokenCache.delete(installationId);
}

export async function fetchInstallationAccessToken(
  githubInstallationId: number
): Promise<InstallationAccessToken | null> {
  const config = getGitHubAppConfig();
  if (!config) return null;

  const cached = tokenCache.get(githubInstallationId);
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
      },
    }
  );

  if (!response.ok) {
    console.warn({
      component: "github-app-token",
      event: "installation_token_failed",
      installationId: githubInstallationId,
      status: response.status,
    });
    tokenCache.delete(githubInstallationId);
    return null;
  }

  const body = (await response.json()) as { token?: string; expires_at?: string };
  if (!body.token || !body.expires_at) return null;

  const expiresAtMs = Date.parse(body.expires_at);
  tokenCache.set(githubInstallationId, {
    token: body.token,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 3_600_000,
  });

  return { token: body.token, expiresAt: body.expires_at };
}
