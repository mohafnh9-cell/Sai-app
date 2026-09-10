import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isScanRateLimitDisabled } from "@/lib/env/scan-rate-limit";

/**
 * Phase 34 P0: authorize_dynamic_target previously had NO rate limiting at
 * all (see the Phase 33 pentesting audit) -- unlike review_now's MCP-review
 * limiter (server/review-now/rate-limit.ts), which this mirrors. Bounds the
 * write-heavy actions of the tool (each triggers a real outbound HTTP/DNS
 * ownership check, or a GitHub Deployments API call) per organization, using
 * a DB-backed count so it is correctly concurrency-safe and cold-start-safe
 * on serverless, same as the MCP-review limiter.
 */
export const DYNAMIC_TARGET_VERIFICATIONS_PER_ORGANIZATION_PER_HOUR = 20;

function envLimit(): number | null {
  const raw = process.env.DYNAMIC_TARGET_VERIFICATIONS_PER_ORGANIZATION_PER_HOUR?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export async function countRecentDynamicTargetVerifications(
  admin: SupabaseClient,
  organizationId: string,
  windowMs = 60 * 60 * 1000
): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await admin
    .from("dynamic_target_verifications")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", since);
  return count ?? 0;
}

export async function isDynamicTargetAuthorizationRateLimited(
  admin: SupabaseClient,
  organizationId: string,
  limit = envLimit() ?? DYNAMIC_TARGET_VERIFICATIONS_PER_ORGANIZATION_PER_HOUR
): Promise<boolean> {
  if (isScanRateLimitDisabled() || limit == null) return false;
  const recentCount = await countRecentDynamicTargetVerifications(admin, organizationId);
  return recentCount >= limit;
}
