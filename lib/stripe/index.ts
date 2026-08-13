import Stripe from "stripe";
import { BUILDER_PLAN as BUILDER_PLAN_PUBLIC } from "@/lib/billing/builder-plan";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    _stripe = new Stripe(key, {
      apiVersion: "2026-06-24.dahlia",
      typescript: true,
    });
  }
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_BUILDER_PRICE_ID &&
      process.env.STRIPE_WEBHOOK_SECRET
  );
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export const BUILDER_PLAN = {
  ...BUILDER_PLAN_PUBLIC,
  priceId: process.env.STRIPE_BUILDER_PRICE_ID ?? "",
} as const;

export type PlanKey = typeof BUILDER_PLAN.id;
