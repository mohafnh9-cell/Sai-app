import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type GitHubTokenFailureReason = "expired" | "revoked" | "invalid";

export async function markWorkspaceGitHubTokenFailure(
  admin: SupabaseClient,
  input: {
    connectionId: string;
    organizationId: string;
    reason: GitHubTokenFailureReason;
  }
): Promise<void> {
  const status = input.reason === "revoked" ? "revoked" : "expired";
  const lastError =
    input.reason === "revoked"
      ? "GitHub token was revoked. Reconnect GitHub in Workspace settings."
      : "GitHub token expired. Reconnect GitHub in Workspace settings.";

  await admin
    .from("workspace_github_connections")
    .update({
      status,
      last_error: lastError,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.connectionId)
    .eq("organization_id", input.organizationId);
}

export function classifyGitHubHttpAuthFailure(status: number): GitHubTokenFailureReason | null {
  if (status === 401) return "expired";
  if (status === 403) return "revoked";
  return null;
}

export async function validateGitHubAccessToken(
  admin: SupabaseClient,
  input: { token: string; connectionId: string; organizationId: string }
): Promise<boolean> {
  if (process.env.NODE_ENV === "test") {
    return true;
  }

  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (response.ok) return true;

  const reason = classifyGitHubHttpAuthFailure(response.status);
  if (reason) {
    await markWorkspaceGitHubTokenFailure(admin, {
      connectionId: input.connectionId,
      organizationId: input.organizationId,
      reason,
    });
  }
  return false;
}

export async function handleGitHubApiAuthFailure(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    connectionId?: string | null;
    httpStatus: number;
  }
): Promise<void> {
  const reason = classifyGitHubHttpAuthFailure(input.httpStatus);
  if (!reason || !input.connectionId) return;
  await markWorkspaceGitHubTokenFailure(admin, {
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    reason,
  });
}

