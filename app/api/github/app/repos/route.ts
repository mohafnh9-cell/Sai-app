import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { loadInstallationForOrganization } from "@/server/github-app/installation-store";
import { GitHubInstallationApiError, listInstallationRepositories } from "@/server/github-app/github-api";
import { isGitHubAppConfigured } from "@/server/github-app/config";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
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

  let repos;
  try {
    repos = await listInstallationRepositories(installation.github_installation_id);
  } catch (error) {
    if (error instanceof GitHubInstallationApiError) {
      console.error("github_app_repos_list_failed", {
        installationId: installation.id,
        status: error.status,
        message: error.message,
      });
      return NextResponse.json(
        { error: githubErrorMessage(error.status), code: githubErrorCode(error.status) },
        { status: githubErrorStatus(error.status) }
      );
    }
    console.error("github_app_repos_list_failed", {
      installationId: installation.id,
      errorType: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      {
        error:
          "Could not list GitHub repositories due to an unexpected error (not a GitHub API response -- check server logs for the real cause, e.g. a malformed GITHUB_APP_PRIVATE_KEY).",
        code: "github_error",
      },
      { status: 502 }
    );
  }

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

/** Never leak the raw upstream status verbatim as our own semantics -- map to our safe status set. */
function githubErrorStatus(upstreamStatus: number): number {
  if (upstreamStatus === 401 || upstreamStatus === 403) return 403;
  if (upstreamStatus === 404) return 404;
  if (upstreamStatus === 429) return 429;
  return 502;
}

function githubErrorCode(upstreamStatus: number): string {
  if (upstreamStatus === 401 || upstreamStatus === 403) return "github_forbidden";
  if (upstreamStatus === 404) return "github_not_found";
  if (upstreamStatus === 429) return "github_rate_limited";
  return "github_unavailable";
}

/** Actionable, distinct text per real cause -- shown directly in the UI. */
function githubErrorMessage(upstreamStatus: number): string {
  if (upstreamStatus === 401 || upstreamStatus === 403) {
    return "GitHub denied access to this installation (expired token or insufficient permissions). Try \"Reconnect GitHub\", or check that the SequrAI GitHub App is still installed and active at github.com/settings/installations.";
  }
  if (upstreamStatus === 404) {
    return "GitHub reports this App installation no longer exists. It was likely uninstalled on GitHub's side -- reconnect GitHub to create a new installation.";
  }
  if (upstreamStatus === 429) {
    return "GitHub rate limit reached while listing repositories. Wait a minute and try again.";
  }
  return `GitHub is temporarily unavailable (status ${upstreamStatus}). Try again shortly.`;
}
