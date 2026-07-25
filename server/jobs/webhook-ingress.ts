import "server-only";

import { createAdminClient } from "@/server/security-scanner/admin-client";
import {
  findWebhookIngressJob,
} from "@/server/jobs/scan-job-store";
import {
  isDeliveryAlreadyHandled,
} from "@/server/github-automation/delivery-idempotency";
import { scheduleWebhookProcessing } from "@/server/jobs/schedule-scan";
import { emitOperationalEvent } from "@/server/observability/operational-events";

export type WebhookIngressResult =
  | { status: "duplicate"; deliveryId: string | null }
  | { status: "accepted"; deliveryId: string | null; scanJobId: string | null };

async function resolveOrganizationIdFromPayload(
  payload: Record<string, unknown>
): Promise<string | null> {
  const repository = payload.repository as { id?: number } | undefined;
  if (!repository?.id) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("projects")
    .select("organization_id")
    .eq("github_repository_id", repository.id)
    .limit(1)
    .maybeSingle();

  return (data?.organization_id as string | undefined) ?? null;
}

export async function ingestGitHubWebhook(input: {
  deliveryId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<WebhookIngressResult> {
  const admin = createAdminClient();

  if (input.deliveryId) {
    if (await isDeliveryAlreadyHandled(admin, input.deliveryId)) {
      await emitOperationalEvent(admin, {
        eventType: "duplicate_webhook_detected",
        metadata: { deliveryId: input.deliveryId, reason: "repository_events_terminal" },
      });
      return { status: "duplicate", deliveryId: input.deliveryId };
    }

    const existingJob = await findWebhookIngressJob(admin, input.deliveryId);
    if (
      existingJob &&
      ["queued", "running", "completed"].includes(existingJob.status)
    ) {
      await emitOperationalEvent(admin, {
        eventType: "duplicate_webhook_detected",
        scanJobId: existingJob.id,
        organizationId: existingJob.organization_id,
        metadata: { deliveryId: input.deliveryId, reason: "scan_jobs_existing" },
      });
      return { status: "duplicate", deliveryId: input.deliveryId };
    }
  }

  const organizationId = await resolveOrganizationIdFromPayload(input.payload);

  if (!organizationId) {
    const { after } = await import("next/server");
    const { processGitHubWebhookEvent } = await import(
      "@/server/github-automation/orchestrator"
    );
    after(() =>
      processGitHubWebhookEvent({
        eventType: input.eventType,
        deliveryId: input.deliveryId,
        payload: input.payload,
      }).catch((error) => {
        console.error({
          component: "webhook-ingress",
          event: "unscoped_processing_failed",
          deliveryId: input.deliveryId,
          eventType: input.eventType,
          message: error instanceof Error ? error.message : "unknown",
        });
      })
    );
    return { status: "accepted", deliveryId: input.deliveryId, scanJobId: null };
  }

  const { scanJobId, duplicate } = await scheduleWebhookProcessing({
    deliveryId: input.deliveryId,
    eventType: input.eventType,
    payload: input.payload,
    organizationId,
  });

  if (duplicate) {
    return { status: "duplicate", deliveryId: input.deliveryId };
  }

  return { status: "accepted", deliveryId: input.deliveryId, scanJobId };
}
