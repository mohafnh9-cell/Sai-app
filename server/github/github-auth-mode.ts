import "server-only";

export type GitHubAuthMode = "oauth_legacy" | "github_app";

export type GitHubAppInstallationStatus = "active" | "suspended" | "revoked";

export type GitHubAppInstallationRecord = {
  id: string;
  organizationId: string;
  githubInstallationId: number;
  githubAccountId: number;
  githubAccountLogin: string;
  githubAccountType: "User" | "Organization";
  status: GitHubAppInstallationStatus;
  permissionsSnapshot: Record<string, string>;
  repositorySelection: string | null;
};

/**
 * Target GitHub App permissions for migration (not yet enforced in production).
 * Contents/Pull requests remain read-only; Checks/Statuses/Webhooks are write where required.
 */
export const GITHUB_APP_TARGET_PERMISSIONS = {
  contents: "read",
  metadata: "read",
  pull_requests: "read",
  statuses: "write",
  checks: "write",
  webhooks: "write",
} as const;

export function isLegacyOAuthMode(mode: GitHubAuthMode | null | undefined): boolean {
  return !mode || mode === "oauth_legacy";
}
