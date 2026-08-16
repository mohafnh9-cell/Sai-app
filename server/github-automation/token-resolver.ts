import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveGitHubCredential } from "@/server/github-app/credential-provider";

export async function resolveOrganizationGitHubToken(
  admin: SupabaseClient,
  organizationId: string,
  projectId?: string
): Promise<{ token: string; userId: string; authSource?: "github_app" | "oauth_legacy" } | null> {
  const credential = await resolveGitHubCredential(admin, organizationId, projectId);
  if (credential) {
    return {
      token: credential.token,
      userId: credential.userId,
      authSource: credential.source,
    };
  }

  // Legacy fallback during migration only when table is missing.
  try {
    const client = createAdminClient();
    const { error } = await client.from("workspace_github_connections").select("id").limit(1);
    if (error?.code === "42P01") {
      const { getStoredGitHubToken } = await import("@/lib/github/token-store");
      const { data: members } = await admin
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", organizationId)
        .eq("role", "OWNER")
        .limit(1);
      const ownerId = members?.[0]?.user_id;
      if (!ownerId) return null;
      const token = await getStoredGitHubToken(ownerId);
      return token ? { token, userId: ownerId } : null;
    }
  } catch {
    return null;
  }

  return null;
}
