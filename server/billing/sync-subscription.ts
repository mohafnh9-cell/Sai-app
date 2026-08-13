import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { OrgPlan, SubscriptionStatus } from "@/types/database";

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "unpaid":
      return "unpaid";
    default:
      return "canceled";
  }
}

function resolveOrgPlan(status: SubscriptionStatus): OrgPlan {
  return status === "active" || status === "trialing" ? "BUILDER" : "FREE";
}

export type SyncSubscriptionInput = {
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
};

export async function upsertOrganizationSubscription(
  admin: SupabaseClient,
  input: SyncSubscriptionInput
): Promise<void> {
  const plan = resolveOrgPlan(input.status);

  const { error: subscriptionError } = await admin.from("subscriptions").upsert(
    {
      organization_id: input.organizationId,
      stripe_customer_id: input.stripeCustomerId,
      stripe_subscription_id: input.stripeSubscriptionId,
      plan,
      status: input.status,
      current_period_end: input.currentPeriodEnd,
    },
    { onConflict: "organization_id" }
  );

  if (subscriptionError) {
    throw new Error(`Failed to upsert subscription: ${subscriptionError.message}`);
  }

  const { error: orgError } = await admin
    .from("organizations")
    .update({ plan })
    .eq("id", input.organizationId);

  if (orgError) {
    throw new Error(`Failed to update organization plan: ${orgError.message}`);
  }
}

export async function syncSubscriptionFromStripe(
  admin: SupabaseClient,
  subscription: Stripe.Subscription,
  organizationId?: string
): Promise<void> {
  const orgId = organizationId ?? subscription.metadata.organization_id;
  if (!orgId) {
    throw new Error("Missing organization_id in Stripe subscription metadata");
  }

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const periodEndSeconds =
    subscription.items.data[0]?.current_period_end ??
    (subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end;

  const currentPeriodEnd = periodEndSeconds
    ? new Date(periodEndSeconds * 1000).toISOString()
    : null;

  await upsertOrganizationSubscription(admin, {
    organizationId: orgId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    status: mapStripeStatus(subscription.status),
    currentPeriodEnd,
  });
}

export async function syncSubscriptionFromCheckoutSession(
  admin: SupabaseClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session
): Promise<void> {
  const organizationId = session.metadata?.organization_id;
  const subscriptionId = session.subscription;

  if (!organizationId || !subscriptionId) {
    throw new Error("Checkout session missing organization_id or subscription");
  }

  const subscriptionIdStr =
    typeof subscriptionId === "string" ? subscriptionId : subscriptionId.id;

  const subscription = await stripe.subscriptions.retrieve(subscriptionIdStr);
  await syncSubscriptionFromStripe(admin, subscription, organizationId);
}
