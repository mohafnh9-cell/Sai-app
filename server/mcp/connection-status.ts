import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Real MCP connection state for an organization: whether at least one
 * non-revoked MCP API key exists (same `mcp_api_keys` table the
 * McpApiKeysPanel and MCP auth middleware already read/write).
 */
export async function getMcpConnectionStatus(
  supabase: SupabaseClient,
  organizationId: string
): Promise<{ connected: boolean }> {
  const { count } = await supabase
    .from("mcp_api_keys")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("revoked_at", null);

  return { connected: (count ?? 0) > 0 };
}
