import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { isSubscriptionAdminEmail } from "@/lib/billing/admin-access";
import { organizationHasActiveSubscription } from "@/server/billing/subscription-status";
import { consumeFreeScanCredit, FREE_SCAN_LIMIT } from "@/server/billing/entitlements";
import { ScanRequestError } from "@/server/security-scanner/request-context";

export async function assertOrganizationCanRunScan(
  admin: SupabaseClient,
  organizationId: string,
  user: { id: string; email?: string | null }
): Promise<void> {
  if (!isBillingEnabled()) return;

  let email = user.email?.trim() ?? null;

  if (!email) {
    const { data: profile } = await admin
      .from("profiles")
      .select("email")
      .eq("id", user.id)
      .maybeSingle();
    email = profile?.email?.trim() ?? null;
  }

  if (isSubscriptionAdminEmail(email)) return;

  const active = await organizationHasActiveSubscription(admin, organizationId);
  if (active) return;

  // No active paid subscription: fall back to the Free plan's scan credit
  // instead of an unconditional block. This is the single point every scan
  // path (manual, upload, CI, review-now/MCP, GitHub automation, on-push)
  // funnels through via assertOrganizationCanRunScan, so the limit applies
  // everywhere without duplicated gating logic.
  //
  // Consumption policy: a credit is spent when this gate grants access,
  // which in every current call site is the last authorization check
  // immediately before scan-job creation. A scan that fails afterwards for
  // an unrelated infrastructure reason (e.g. a GitHub API outage) still
  // consumes a credit under this policy -- documented here rather than
  // building refund/compensation logic, per the deterministic-and-fair
  // requirement: the policy is the same for every organization and every
  // path, not silently inconsistent between them.
  const granted = await consumeFreeScanCredit(admin, organizationId);
  if (granted) return;

  throw new ScanRequestError(
    402,
    "SCAN_LIMIT_REACHED",
    `Free plan includes ${FREE_SCAN_LIMIT} security scans. Subscribe to Builder Edition to keep scanning.`
  );
}
