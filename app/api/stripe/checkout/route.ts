import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { BUILDER_PLAN, getStripe, isStripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { ensureStripeCustomerForOrganization } from "@/server/billing/customer";
import { organizationHasActiveSubscription } from "@/server/billing/subscription-status";

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    limit: 20,
    windowMs: 60_000,
    keyPrefix: "stripe-checkout",
  });
  if (rateLimited) return rateLimited;

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const auth = await getServerAuthContext();
  if (!auth?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const alreadyActive = await organizationHasActiveSubscription(
    auth.supabase,
    auth.organizationId
  );
  if (alreadyActive) {
    return NextResponse.json({ url: "/dashboard", alreadySubscribed: true });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const stripe = getStripe();
  const admin = createAdminClient();

  try {
    const customerId = await ensureStripeCustomerForOrganization(
      admin,
      auth.organizationId,
      auth.user.email ?? "",
      auth.orgName ?? "SequrAI Workspace"
    );

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: BUILDER_PLAN.priceId, quantity: 1 }],
      success_url: `${appUrl}/onboarding?step=github&checkout=success`,
      cancel_url: `${appUrl}/billing?checkout=canceled`,
      metadata: {
        organization_id: auth.organizationId,
        user_id: auth.user.id,
      },
      subscription_data: {
        metadata: {
          organization_id: auth.organizationId,
        },
      },
      allow_promotion_codes: true,
    });

    if (!session.url) {
      return NextResponse.json({ error: "Could not create checkout session" }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start checkout";
    console.error({ component: "stripe-checkout", error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
