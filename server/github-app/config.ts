import "server-only";

export type GitHubAppConfig = {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  clientId: string | null;
  clientSecret: string | null;
  appSlug: string;
};

function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function isGitHubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID?.trim() &&
      process.env.GITHUB_APP_PRIVATE_KEY?.trim() &&
      process.env.GITHUB_APP_WEBHOOK_SECRET?.trim() &&
      process.env.GITHUB_APP_SLUG?.trim()
  );
}

export function getGitHubAppConfig(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET?.trim();
  const appSlug = process.env.GITHUB_APP_SLUG?.trim();

  if (!appId || !privateKeyRaw || !webhookSecret || !appSlug) {
    return null;
  }

  return {
    appId,
    privateKey: normalizePrivateKey(privateKeyRaw),
    webhookSecret,
    clientId: process.env.GITHUB_APP_CLIENT_ID?.trim() ?? null,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET?.trim() ?? null,
    appSlug,
  };
}

export function getGitHubAppInstallUrl(state?: string): string | null {
  const config = getGitHubAppConfig();
  if (!config) return null;
  const base = `https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new`;
  if (!state) return base;
  return `${base}?state=${encodeURIComponent(state)}`;
}
