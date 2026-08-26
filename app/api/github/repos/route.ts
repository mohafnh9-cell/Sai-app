import { NextResponse } from "next/server";
import { getGitHubRepos, getGitHubTokenScopes } from "@/lib/github";
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
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch GitHub repositories", code: "internal_error" },
      { status: 500 }
    );
  }
}
