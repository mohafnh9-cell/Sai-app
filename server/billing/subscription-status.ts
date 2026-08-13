import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubscriptionStatus } from "@/types/database";
import { hasActiveSubscriptionStatus } from "@/lib/billing/access";

export type SubscriptionRecord = {
  organizationId: string;
  plan: string;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
};

export function hasActiveSubscription(
  subscription: Pick<SubscriptionRecord, "status"> | null | undefined
): boolean {
  return hasActiveSubscriptionStatus(subscription?.status);
}

export async function getOrganizationSubscription(
  supabase: SupabaseClient,
  organizationId: string
): Promise<SubscriptionRecord | null> {
  const { data } = await supabase
    .from("subscriptions")
    .select(
      "organization_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end"
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!data) return null;

  return {
    organizationId: data.organization_id,
    plan: data.plan,
    status: data.status as SubscriptionStatus,
    stripeCustomerId: data.stripe_customer_id,
    stripeSubscriptionId: data.stripe_subscription_id,
    currentPeriodEnd: data.current_period_end,
  };
}

export async function organizationHasActiveSubscription(
  supabase: SupabaseClient,
  organizationId: string
): Promise<boolean> {
  const subscription = await getOrganizationSubscription(supabase, organizationId);
  return hasActiveSubscription(subscription);
}
