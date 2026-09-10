import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasActiveSubscriptionStatus } from "@/lib/billing/access";
import type { SubscriptionStatus } from "@/types/database";

/** Free plan includes 2 security scans. Enforced server-side, atomically -- see migration 060. */
export const FREE_SCAN_LIMIT = 2;

export type OrganizationEntitlements = {
  plan: string;
  subscriptionStatus: SubscriptionStatus | null;
  /** null = unlimited (active paid subscription). */
  scanLimit: number | null;
  scansUsed: number;
  /** null = unlimited. */
  scansRemaining: number | null;
  canScan: boolean;
  upgradeRequired: boolean;
};

/**
 * Read-only view of what an organization is entitled to today. Safe to
 * expose to clients (MCP, API, future UI) -- it never includes Stripe
 * customer/subscription IDs or other billing internals.
 */
export async function getOrganizationEntitlements(
  admin: SupabaseClient,
  organizationId: string
): Promise<OrganizationEntitlements> {
  const { data } = await admin
    .from("subscriptions")
    .select("plan, status, free_scans_used")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const plan = data?.plan ?? "FREE";
  const status = (data?.status as SubscriptionStatus | undefined) ?? null;
  const scansUsed = data?.free_scans_used ?? 0;

  if (hasActiveSubscriptionStatus(status)) {
    return {
      plan,
      subscriptionStatus: status,
      scanLimit: null,
      scansUsed,
      scansRemaining: null,
      canScan: true,
      upgradeRequired: false,
    };
  }

  const scansRemaining = Math.max(0, FREE_SCAN_LIMIT - scansUsed);

  return {
    plan,
    subscriptionStatus: status,
    scanLimit: FREE_SCAN_LIMIT,
    scansUsed,
    scansRemaining,
    canScan: scansRemaining > 0,
    upgradeRequired: scansRemaining <= 0,
  };
}

/**
 * Atomically consumes one free-plan scan credit for an organization.
 * Returns true if a credit was available and was consumed; false if the
 * organization has already used all `FREE_SCAN_LIMIT` credits.
 *
 * Backed by the `consume_free_scan_credit` Postgres function (migration
 * 060): the increment and the limit check happen inside a single atomic
 * `UPDATE ... WHERE free_scans_used < limit`, which Postgres serializes at
 * the row level. Two simultaneous calls with exactly one credit remaining
 * can never both return true -- this is not a read-then-write race.
 */
export async function consumeFreeScanCredit(
  admin: SupabaseClient,
  organizationId: string
): Promise<boolean> {
  const { data, error } = await admin.rpc("consume_free_scan_credit", {
    p_organization_id: organizationId,
    p_limit: FREE_SCAN_LIMIT,
  });

  if (error) throw error;
  return data === true;
}
