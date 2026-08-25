import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { getOrganizationSubscription } from "@/server/billing/subscription-status";

function validateStripeCustomerId(value: string): boolean {
  return /^cus_[A-Za-z0-9]+$/.test(value);
}

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    limit: 20,
    windowMs: 60_000,
    keyPrefix: "stripe-portal",
  });
  if (rateLimited) return rateLimited;

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const auth = await getServerAuthContext();
  if (!auth?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscription = await getOrganizationSubscription(auth.supabase, auth.organizationId);
  if (!subscription?.stripeCustomerId || !validateStripeCustomerId(subscription.stripeCustomerId)) {
    return NextResponse.json({ error: "No billing account found" }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const stripe = getStripe();

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${appUrl}/billing`,
  });

  return NextResponse.json({ url: portalSession.url });
}
