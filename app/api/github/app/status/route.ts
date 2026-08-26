import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { loadInstallationForOrganization } from "@/server/github-app/installation-store";
import { isGitHubAppConfigured } from "@/server/github-app/config";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";

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
    webhookUrl: configured
      ? `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/api/webhooks/github-app`
      : null,
  });
}
