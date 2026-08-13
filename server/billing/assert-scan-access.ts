import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSubscriptionAdminEmail } from "@/lib/billing/admin-access";
import { organizationHasActiveSubscription } from "@/server/billing/subscription-status";
import { ScanRequestError } from "@/server/security-scanner/request-context";

export async function assertOrganizationCanRunScan(
  admin: SupabaseClient,
  organizationId: string,
  user: { id: string; email?: string | null }
): Promise<void> {
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

  throw new ScanRequestError(
    402,
    "SUBSCRIPTION_REQUIRED",
    "Subscribe to Builder Edition to run Production Reviews."
  );
}
