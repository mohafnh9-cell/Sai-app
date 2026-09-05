import { NextResponse } from "next/server";
import { GitHubApiError, getGitHubRepos, getGitHubTokenScopes } from "@/lib/github";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveWorkspaceGitHubToken } from "@/server/github/workspace-connection-service";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }
  if (!auth.organizationId) {
    return NextResponse.json(
      { error: "No active Workspace", code: "workspace_not_found", needsReauth: true },
      { status: 404 }
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "GitHub integration is not configured", code: "internal_error" },
      { status: 500 }
    );
  }

  const tokenResult = await resolveWorkspaceGitHubToken(admin, auth.organizationId);
  if (!tokenResult) {
    return NextResponse.json(
      {
        error: "GitHub is not connected to this Workspace.",
        code: "github_not_connected",
        needsReauth: true,
      },
      { status: 403 }
    );
  }

  try {
    const scopes = await getGitHubTokenScopes(tokenResult.token);
    if (!scopes.includes("repo")) {
      return NextResponse.json(
        {
          error: "GitHub access must be upgraded to include private repositories.",
          code: "github_reauthorization_required",
          needsReauth: true,
        },
        { status: 403 }
      );
    }

    const repos = await getGitHubRepos(tokenResult.token);
    return NextResponse.json({ repos, scopes, workspaceId: auth.organizationId });
  } catch (error) {
    // Phase 31.2: 401/403 (expired/insufficient token), 429 (rate limited),
    // and a genuine 5xx/network failure used to all collapse into one
    // generic 500 -- the caller couldn't tell "reconnect GitHub" apart from
    // "try again in a minute" apart from "GitHub is down."
    if (error instanceof GitHubApiError) {
      if (error.status === 401 || error.status === 403) {
        return NextResponse.json(
          {
            error: "GitHub access has expired or is insufficient.",
            code: "github_reauthorization_required",
            needsReauth: true,
          },
          { status: 403 }
        );
      }
      if (error.status === 429) {
        return NextResponse.json(
          { error: "GitHub rate limit reached. Try again shortly.", code: "github_rate_limited" },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: "GitHub is temporarily unavailable.", code: "github_unavailable" },
        { status: 502 }
      );
    }
    console.error("github_repos_list_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Failed to fetch GitHub repositories", code: "internal_error" },
      { status: 500 }
    );
  }
}
