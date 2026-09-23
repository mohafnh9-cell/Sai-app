import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { loadInstallationForOrganization } from "@/server/github-app/installation-store";
import { isGitHubAppConfigured } from "@/server/github-app/config";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import {
  discoverVerifiedInstallationsForUser,
  resolveGitHubProviderId,
} from "@/server/github-app/installation-authorization";

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
  const admin = createAdminClient();
  let installation = null;
  if (configured) {
    installation = await loadInstallationForOrganization(admin, auth.organizationId);
  }

  // Only worth checking when this organization has nothing attached yet --
  // avoids unnecessary GitHub round trips on the common "already
  // connected" path. A GitHub App installation is scoped to a GitHub
  // account, not to a SequrAI organization, so the authenticated user's
  // own GitHub identity may already have SequrAI installed for a
  // *different* organization; if so, surface it as an explicit,
  // user-chosen "use existing installation" option (POST
  // /api/github/app/attach) rather than sending them back through a
  // GitHub install flow that won't run a fresh callback for an
  // already-installed account. Candidates are discovered only from THIS
  // user's own verified GitHub identity (resolveGitHubProviderId) and
  // independently re-verified live against GitHub -- never from another,
  // unrelated GitHub identity, and never exposing anything about which
  // other SequrAI organization(s) also hold the installation.
  let availableInstallations: Array<{ installationId: number; accountLogin: string }> = [];
  if (configured && !installation) {
    const providerId = await resolveGitHubProviderId(admin, auth.user.id);
    if (providerId !== null) {
      const verified = await discoverVerifiedInstallationsForUser(admin, providerId);
      availableInstallations = verified.map((entry) => ({
        installationId: entry.githubInstallationId,
        accountLogin: entry.accountLogin,
      }));
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
