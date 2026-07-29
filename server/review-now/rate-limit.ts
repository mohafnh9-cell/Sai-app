import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isScanRateLimitDisabled,
  mcpReviewsPerOrganizationPerHourLimit,
} from "@/lib/env/scan-rate-limit";

/**
 * Private Beta bound on MCP-triggered reviews per organization per hour.
 * This is layered under (not a replacement for) the generic per-IP MCP
 * endpoint rate limit in server/http/rate-limit.ts — that one protects the
 * HTTP endpoint, this one protects compute (repository fetch + scan) per
 * tenant regardless of how many API keys or IPs an organization uses.
 */
export const MCP_REVIEWS_PER_ORGANIZATION_PER_HOUR = 10;

export { isScanRateLimitDisabled };

export async function countRecentMcpReviews(
  admin: SupabaseClient,
  organizationId: string,
  windowMs = 60 * 60 * 1000
): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await admin
    .from("scans")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("trigger_type", "mcp")
    .gte("created_at", since);
  return count ?? 0;
}

export async function isMcpReviewRateLimited(
  admin: SupabaseClient,
  organizationId: string,
  limit = mcpReviewsPerOrganizationPerHourLimit() ?? MCP_REVIEWS_PER_ORGANIZATION_PER_HOUR
): Promise<boolean> {
  if (isScanRateLimitDisabled() || limit == null) return false;
  const recentCount = await countRecentMcpReviews(admin, organizationId);
  return recentCount >= limit;
}
