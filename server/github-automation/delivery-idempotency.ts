import type { SupabaseClient } from "@supabase/supabase-js";

const TERMINAL_DELIVERY_STATUSES = new Set([
  "processed",
  "failed",
  "ignored",
]);

export function isTerminalDeliveryStatus(status: string): boolean {
  return TERMINAL_DELIVERY_STATUSES.has(status);
}

export type DeliveryClaimResult =
  | { claimed: true; eventId: string; status: "processing" }
  | {
      claimed: false;
      reason: "duplicate" | "in_flight";
      status: string | null;
      eventId?: string | null;
    };

export async function findDeliveryEventStatus(
  admin: SupabaseClient,
  organizationId: string,
  deliveryId: string | null
): Promise<string | null> {
  if (!deliveryId) return null;

  const { data, error } = await admin
    .from("repository_events")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("github_delivery_id", deliveryId)
    .maybeSingle();

  if (error) {
    console.warn("delivery_status_lookup_failed", {
      organizationId,
      deliveryId,
      message: error.message,
    });
    return null;
  }

  return data?.status ?? null;
}

export async function findDeliveryEvent(
  admin: SupabaseClient,
  organizationId: string,
  deliveryId: string
): Promise<{ id: string; status: string } | null> {
  const { data, error } = await admin
    .from("repository_events")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("github_delivery_id", deliveryId)
    .maybeSingle();

  if (error) {
    console.warn("delivery_lookup_failed", {
      organizationId,
      deliveryId,
      message: error.message,
    });
    return null;
  }

  return data ? { id: data.id as string, status: data.status as string } : null;
}

export async function isDeliveryAlreadyHandled(
  admin: SupabaseClient,
  organizationId: string,
  deliveryId: string | null
): Promise<boolean> {
  const status = await findDeliveryEventStatus(admin, organizationId, deliveryId);
  return status != null && isTerminalDeliveryStatus(status);
}

async function reclaimFailedDeliveryEvent(
  admin: SupabaseClient,
  organizationId: string,
  deliveryId: string
): Promise<{ id: string } | null> {
  const { data, error } = await admin
    .from("repository_events")
    .update({
      status: "processing",
      error_message: null,
      processed_at: null,
    })
    .eq("organization_id", organizationId)
    .eq("github_delivery_id", deliveryId)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("delivery_reclaim_failed", {
      organizationId,
      deliveryId,
      message: error.message,
    });
    return null;
  }

  return data ? { id: data.id as string } : null;
}

/**
 * Atomically claim a GitHub webhook delivery for an organization.
 * Only the request that inserts the row (or reclaims a failed row) owns processing.
 */
export async function claimDeliveryEvent(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    deliveryId: string;
    eventType: string;
    payload: Record<string, unknown>;
    action?: string;
    branch?: string;
    commitSha?: string;
    baseCommitSha?: string;
    pullRequestNumber?: number;
  }
): Promise<DeliveryClaimResult> {
  const { data, error } = await admin
    .from("repository_events")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      github_delivery_id: input.deliveryId,
      event_type: input.eventType,
      action: input.action ?? null,
      branch: input.branch ?? null,
      commit_sha: input.commitSha ?? null,
      base_commit_sha: input.baseCommitSha ?? null,
      pull_request_number: input.pullRequestNumber ?? null,
      payload: input.payload,
      status: "processing",
    })
    .select("id")
    .maybeSingle();

  if (!error && data?.id) {
    return { claimed: true, eventId: data.id as string, status: "processing" };
  }

  if (error?.code !== "23505") {
    throw new Error(`Could not claim delivery event: ${error?.message ?? "unknown"}`);
  }

  const existing = await findDeliveryEvent(admin, input.organizationId, input.deliveryId);
  if (!existing) {
    return { claimed: false, reason: "in_flight", status: null };
  }

  if (existing.status === "failed") {
    const reclaimed = await reclaimFailedDeliveryEvent(
      admin,
      input.organizationId,
      input.deliveryId
    );
    if (reclaimed) {
      return { claimed: true, eventId: reclaimed.id, status: "processing" };
    }
  }

  if (isTerminalDeliveryStatus(existing.status)) {
    return {
      claimed: false,
      reason: "duplicate",
      status: existing.status,
      eventId: existing.id,
    };
  }

  return {
    claimed: false,
    reason: "in_flight",
    status: existing.status,
    eventId: existing.id,
  };
}

export type DeliveryProcessingGateResult =
  | { shouldProcess: true; eventId?: string | null }
  | { shouldProcess: false; reason: "duplicate" | "in_flight"; status: string | null };

/**
 * Gate orchestrator processing for a delivery. Claims new deliveries, allows
 * continuation when the delivery is already in-flight, and rejects terminals.
 */
export async function ensureDeliveryProcessing(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    deliveryId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }
): Promise<DeliveryProcessingGateResult> {
  const existing = await findDeliveryEvent(admin, input.organizationId, input.deliveryId);
  if (!existing) {
    const claim = await claimDeliveryEvent(admin, input);
    if (claim.claimed) {
      return { shouldProcess: true, eventId: claim.eventId };
    }
    return {
      shouldProcess: false,
      reason: claim.reason,
      status: claim.status,
    };
  }

  if (isTerminalDeliveryStatus(existing.status)) {
    return { shouldProcess: false, reason: "duplicate", status: existing.status };
  }

  if (existing.status === "processing") {
    return { shouldProcess: true, eventId: existing.id };
  }

  return { shouldProcess: false, reason: "in_flight", status: existing.status };
}

export async function updateDeliveryEventStatus(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    deliveryId: string;
    status: string;
    eventType?: string;
    action?: string;
    branch?: string;
    commitSha?: string;
    baseCommitSha?: string;
    pullRequestNumber?: number;
    payload?: Record<string, unknown>;
    errorMessage?: string;
  }
): Promise<void> {
  const { error } = await admin
    .from("repository_events")
    .update({
      status: input.status,
      event_type: input.eventType,
      action: input.action ?? null,
      branch: input.branch ?? null,
      commit_sha: input.commitSha ?? null,
      base_commit_sha: input.baseCommitSha ?? null,
      pull_request_number: input.pullRequestNumber ?? null,
      payload: input.payload,
      error_message: input.errorMessage ?? null,
      processed_at:
        input.status === "processed" || input.status === "ignored"
          ? new Date().toISOString()
          : null,
    })
    .eq("organization_id", input.organizationId)
    .eq("github_delivery_id", input.deliveryId);

  if (error) {
    console.warn("delivery_status_update_failed", {
      organizationId: input.organizationId,
      deliveryId: input.deliveryId,
      status: input.status,
      message: error.message,
    });
  }
}
