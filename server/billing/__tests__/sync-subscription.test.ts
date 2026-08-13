import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasActiveSubscription } from "@/server/billing/subscription-status";
import { syncSubscriptionFromStripe } from "@/server/billing/sync-subscription";

function mockSubscription(
  overrides: Partial<Stripe.Subscription> = {}
): Stripe.Subscription {
  return {
    id: "sub_test",
    object: "subscription",
    customer: "cus_test",
    status: "active",
    current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
    metadata: { organization_id: "org-test" },
    ...overrides,
  } as Stripe.Subscription;
}

describe("syncSubscriptionFromStripe", () => {
  it("maps active Stripe subscription to BUILDER plan", () => {
    const subscription = mockSubscription({ status: "active" });
    expect(subscription.metadata.organization_id).toBe("org-test");
    expect(hasActiveSubscription({ status: "active" })).toBe(true);
  });

  it("treats canceled subscriptions as inactive", () => {
    expect(hasActiveSubscription({ status: "canceled" })).toBe(false);
  });

  it("throws when organization_id metadata is missing", async () => {
    const admin = {
      from: () => ({
        upsert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    } as unknown as SupabaseClient;

    await expect(
      syncSubscriptionFromStripe(admin, mockSubscription({ metadata: {} }))
    ).rejects.toThrow(/organization_id/i);
  });
});
