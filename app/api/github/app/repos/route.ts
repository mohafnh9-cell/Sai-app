import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { loadInstallationForOrganization } from "@/server/github-app/installation-store";
import { listInstallationRepositories } from "@/server/github-app/github-api";
import { isGitHubAppConfigured } from "@/server/github-app/config";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  if (!isGitHubAppConfigured()) {
    return NextResponse.json({ repos: [], configured: false });
  }

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

  const admin = createAdminClient();
  const installation = await loadInstallationForOrganization(admin, auth.organizationId);
  if (!installation || installation.status !== "active" || installation.revoked_at) {
    return NextResponse.json({ repos: [], configured: true, installationActive: false });
  }

  const repos = await listInstallationRepositories(installation.github_installation_id);
  return NextResponse.json({
    configured: true,
    installationActive: true,
    installationId: installation.id,
    repos: repos.map((repo) => ({
      id: repo.id,
      name: repo.full_name.split("/")[1] ?? repo.full_name,
      full_name: repo.full_name,
      description: repo.description,
      html_url: repo.html_url,
      private: repo.private,
      language: repo.language,
      updated_at: repo.updated_at,
      stargazers_count: repo.stargazers_count,
      default_branch: repo.default_branch,
    })),
  });
}
