import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
} from "@/server/billing/stripe-webhook-idempotency";
import {
  syncSubscriptionFromCheckoutSession,
  syncSubscriptionFromStripe,
} from "@/server/billing/sync-subscription";

export const runtime = "nodejs";

async function processStripeEvent(
  admin: ReturnType<typeof createAdminClient>,
  stripe: ReturnType<typeof getStripe>,
  event: Stripe.Event
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        await syncSubscriptionFromCheckoutSession(admin, stripe, session);
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await syncSubscriptionFromStripe(admin, subscription);
      break;
    }
    default:
      break;
  }
}

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const admin = createAdminClient();
  const claim = await claimStripeWebhookEvent(admin, {
    stripeEventId: event.id,
    eventType: event.type,
  });

  if (!claim.claimed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await processStripeEvent(admin, stripe, event);
    await markStripeWebhookEventProcessed(admin, event.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handler failed";
    await markStripeWebhookEventFailed(admin, event.id, message);
    console.error({ component: "stripe-webhook", eventType: event.type, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
