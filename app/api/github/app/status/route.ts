import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { loadInstallationForOrganization } from "@/server/github-app/installation-store";
import { getGitHubAppConfig, isGitHubAppConfigured } from "@/server/github-app/config";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { getStoredGitHubToken } from "@/lib/github/token-store";
import {
  fetchAuthenticatedGitHubUser,
  filterOwnAppInstallations,
  filterSelfAuthorizedInstallations,
  listInstallationsForGitHubUser,
} from "@/server/github-app/user-installations";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth?.organizationId) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const allowed = await assertWorkspaceMembership(
    auth.supabase,
    auth.user.id,
    auth.organizationId
  );
  if (!allowed) {
    return NextResponse.json({ error: "Workspace access denied", code: "workspace_access_denied" }, {
      status: 403,
    });
  }

  const configured = isGitHubAppConfigured();
  let installation = null;
  if (configured) {
    const admin = createAdminClient();
    installation = await loadInstallationForOrganization(admin, auth.organizationId);
  }

  // Only worth checking when this organization has nothing attached yet --
  // avoids an extra GitHub API round trip on the common "already connected"
  // path. A GitHub App installation is scoped to a GitHub account, not to a
  // SequrAI organization, so the authenticated user's GitHub account may
  // already have SequrAI installed for a *different* organization; if so,
  // surface it as an explicit, user-chosen "use existing installation"
  // option (POST /api/github/app/attach) rather than sending them back
  // through a GitHub install flow that won't run a fresh callback for an
  // already-installed account.
  let availableInstallations: Array<{ installationId: number; accountLogin: string; accountType: string }> = [];
  if (configured && !installation) {
    const config = getGitHubAppConfig();
    const userToken = await getStoredGitHubToken(auth.user.id);
    if (config && userToken) {
      const verified = await listInstallationsForGitHubUser(userToken);
      if (verified) {
        const ownAppInstallations = filterOwnAppInstallations(verified, config.appId);
        // Only ever surface installations this server can independently
        // verify the caller is authorized to attach -- never an
        // organization-owned installation merely because the caller has
        // read/write repository access to it. See
        // filterSelfAuthorizedInstallations()'s docblock for the full
        // rationale; keeping the UI and POST /api/github/app/attach in
        // lockstep here means the UI never offers an action the attach
        // endpoint would then reject.
        const self = ownAppInstallations.length > 0 ? await fetchAuthenticatedGitHubUser(userToken) : null;
        if (self) {
          availableInstallations = filterSelfAuthorizedInstallations(ownAppInstallations, self).map(
            (entry) => ({
              installationId: entry.id,
              accountLogin: entry.account.login,
              accountType: entry.account.type,
            })
          );
        }
      }
    }
  }

  return NextResponse.json({
    configured,
    installation: installation
      ? {
          id: installation.id,
          githubInstallationId: installation.github_installation_id,
          accountLogin: installation.github_account_login,
          accountType: installation.github_account_type,
          status: installation.status,
          repositorySelection: installation.repository_selection,
          permissions: installation.permissions_snapshot,
          installedAt: installation.installed_at,
        }
      : null,
    availableInstallations,
    webhookUrl: configured
      ? `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/api/webhooks/github-app`
      : null,
  });
}
