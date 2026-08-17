import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type StripeWebhookClaimResult =
  | { claimed: true; recordId: string }
  | { claimed: false; reason: "duplicate" | "in_flight"; status: string | null };

async function findStripeWebhookEvent(
  admin: SupabaseClient,
  stripeEventId: string
): Promise<{ id: string; status: string } | null> {
  const { data, error } = await admin
    .from("stripe_webhook_events")
    .select("id, status")
    .eq("stripe_event_id", stripeEventId)
    .maybeSingle();

  if (error) {
    console.warn("stripe_webhook_lookup_failed", {
      stripeEventId,
      message: error.message,
    });
    return null;
  }

  return data ? { id: data.id as string, status: data.status as string } : null;
}

async function reclaimFailedStripeWebhookEvent(
  admin: SupabaseClient,
  stripeEventId: string
): Promise<{ id: string } | null> {
  const { data, error } = await admin
    .from("stripe_webhook_events")
    .update({
      status: "processing",
      error_message: null,
      processed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_event_id", stripeEventId)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("stripe_webhook_reclaim_failed", {
      stripeEventId,
      message: error.message,
    });
    return null;
  }

  return data ? { id: data.id as string } : null;
}

export async function claimStripeWebhookEvent(
  admin: SupabaseClient,
  input: { stripeEventId: string; eventType: string }
): Promise<StripeWebhookClaimResult> {
  const { data, error } = await admin
    .from("stripe_webhook_events")
    .insert({
      stripe_event_id: input.stripeEventId,
      event_type: input.eventType,
      status: "processing",
    })
    .select("id")
    .maybeSingle();

  if (!error && data?.id) {
    return { claimed: true, recordId: data.id as string };
  }

  if (error?.code !== "23505") {
    throw new Error(`Could not claim Stripe webhook event: ${error?.message ?? "unknown"}`);
  }

  const existing = await findStripeWebhookEvent(admin, input.stripeEventId);
  if (!existing) {
    return { claimed: false, reason: "in_flight", status: null };
  }

  if (existing.status === "failed") {
    const reclaimed = await reclaimFailedStripeWebhookEvent(admin, input.stripeEventId);
    if (reclaimed) {
      return { claimed: true, recordId: reclaimed.id };
    }
  }

  if (existing.status === "processed") {
    return { claimed: false, reason: "duplicate", status: existing.status };
  }

  return { claimed: false, reason: "in_flight", status: existing.status };
}

export async function markStripeWebhookEventProcessed(
  admin: SupabaseClient,
  stripeEventId: string
): Promise<void> {
  const { error } = await admin
    .from("stripe_webhook_events")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("stripe_event_id", stripeEventId);

  if (error) {
    console.warn("stripe_webhook_mark_processed_failed", {
      stripeEventId,
      message: error.message,
    });
  }
}

export async function markStripeWebhookEventFailed(
  admin: SupabaseClient,
  stripeEventId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await admin
    .from("stripe_webhook_events")
    .update({
      status: "failed",
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_event_id", stripeEventId);

  if (error) {
    console.warn("stripe_webhook_mark_failed_failed", {
      stripeEventId,
      message: error.message,
    });
  }
}
