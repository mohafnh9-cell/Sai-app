import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";

export async function getOrCreateStripeCustomer(
  admin: SupabaseClient,
  stripe: Stripe,
  input: {
    organizationId: string;
    email: string;
    organizationName: string;
  }
): Promise<string> {
  const { data: existing } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (existing?.stripe_customer_id) {
    return existing.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: input.email,
    name: input.organizationName,
    metadata: {
      organization_id: input.organizationId,
    },
  });

  await admin.from("subscriptions").upsert(
    {
      organization_id: input.organizationId,
      stripe_customer_id: customer.id,
      plan: "FREE",
      status: "canceled",
    },
    { onConflict: "organization_id" }
  );

  return customer.id;
}

export async function ensureStripeCustomerForOrganization(
  admin: SupabaseClient,
  organizationId: string,
  userEmail: string,
  organizationName: string
): Promise<string> {
  const stripe = getStripe();
  return getOrCreateStripeCustomer(admin, stripe, {
    organizationId,
    email: userEmail,
    organizationName,
  });
}
