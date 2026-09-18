import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { isPlatformAdmin } from "@/server/billing/platform-admin";
import { getOrganizationSubscription, hasActiveSubscription } from "@/server/billing/subscription-status";
import { consumeFreeScanCredit, FREE_SCAN_LIMIT } from "@/server/billing/entitlements";
import { ScanRequestError } from "@/server/security-scanner/request-context";

export async function assertOrganizationCanRunScan(
  admin: SupabaseClient,
  organizationId: string,
  user: { id: string; email?: string | null }
): Promise<void> {
  if (!isBillingEnabled()) return;

  // Internal SequrAI platform admins get unlimited access -- checked first,
  // before any credit is touched, so admin usage never decrements the Free
  // quota and never requires a Stripe subscription. This is role/plan-
  // independent: see server/billing/platform-admin.ts.
  if (await isPlatformAdmin(admin, user)) return;

  const subscription = await getOrganizationSubscription(admin, organizationId);
  if (hasActiveSubscription(subscription)) return;

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

  // Phase 46: distinguish "never subscribed, used up the 2 free analyses"
  // from "subscribed before, that subscription just isn't active right now"
  // -- a stripe_subscription_id on the row is only ever set once a real
  // Stripe subscription/checkout exists for this org (see
  // sync-subscription.ts), and it is never cleared afterward, so its
  // presence is a reliable signal even after the subscription later lapses
  // and `plan`/`status` revert to FREE/canceled. Every current call site
  // (review-now/trigger-review.ts) already anticipated exactly this second
  // code -- it just never received anything but SCAN_LIMIT_REACHED before.
  // Never resets free_scans_used and never grants access on its own; it
  // only changes which error a denied request receives.
  if (subscription?.stripeSubscriptionId) {
    throw new ScanRequestError(
      402,
      "SUBSCRIPTION_REQUIRED",
      "Your Pro subscription is no longer active. Upgrade to continue running security analyses."
    );
  }

  throw new ScanRequestError(
    402,
    "SCAN_LIMIT_REACHED",
    `You've used your ${FREE_SCAN_LIMIT} free security analyses. Subscribe to Pro to keep scanning.`
  );
}
