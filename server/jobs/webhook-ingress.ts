import "server-only";

import { createAdminClient } from "@/server/security-scanner/admin-client";
import {
  findWebhookIngressJob,
} from "@/server/jobs/scan-job-store";
import {
  claimDeliveryEvent,
  isDeliveryAlreadyHandled,
} from "@/server/github-automation/delivery-idempotency";
import { scheduleWebhookProcessing } from "@/server/jobs/schedule-scan";
import { emitOperationalEvent } from "@/server/observability/operational-events";

export type WebhookIngressResult =
  | { status: "duplicate"; deliveryId: string | null }
  | { status: "accepted"; deliveryId: string | null; scanJobId: string | null };

async function resolveOrganizationContextFromPayload(
  payload: Record<string, unknown>
): Promise<{ organizationId: string; projectId: string } | null> {
  const repository = payload.repository as { id?: number } | undefined;
  if (!repository?.id) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("projects")
    .select("id, organization_id")
    .eq("github_repository_id", repository.id)
    .limit(1)
    .maybeSingle();

  if (!data?.organization_id || !data?.id) return null;
  return {
    organizationId: data.organization_id as string,
    projectId: data.id as string,
  };
}

export async function ingestGitHubWebhook(input: {
  deliveryId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<WebhookIngressResult> {
  const admin = createAdminClient();
  const organizationContext = await resolveOrganizationContextFromPayload(input.payload);

  if (input.deliveryId && organizationContext) {
    if (
      await isDeliveryAlreadyHandled(
        admin,
        organizationContext.organizationId,
        input.deliveryId
      )
    ) {
      await emitOperationalEvent(admin, {
        eventType: "duplicate_webhook_detected",
        organizationId: organizationContext.organizationId,
        metadata: {
          deliveryId: input.deliveryId,
          reason: "repository_events_terminal",
        },
      });
      return { status: "duplicate", deliveryId: input.deliveryId };
    }

    const claim = await claimDeliveryEvent(admin, {
      organizationId: organizationContext.organizationId,
      projectId: organizationContext.projectId,
      deliveryId: input.deliveryId,
      eventType: input.eventType,
      payload: input.payload,
    });
    if (!claim.claimed) {
      await emitOperationalEvent(admin, {
        eventType: "duplicate_webhook_detected",
        organizationId: organizationContext.organizationId,
        metadata: {
          deliveryId: input.deliveryId,
          reason: claim.reason,
          status: claim.status,
        },
      });
      return { status: "duplicate", deliveryId: input.deliveryId };
    }

    const existingJob = await findWebhookIngressJob(
      admin,
      organizationContext.organizationId,
      input.deliveryId
    );
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
  } else if (input.deliveryId) {
    const existingJob = await findWebhookIngressJobByDeliveryId(admin, input.deliveryId);
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

  const organizationId = organizationContext?.organizationId ?? null;

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

async function findWebhookIngressJobByDeliveryId(
  admin: ReturnType<typeof createAdminClient>,
  deliveryId: string
) {
  const { data, error } = await admin
    .from("scan_jobs")
    .select("*")
    .eq("github_delivery_id", deliveryId)
    .eq("job_type", "webhook_process")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load webhook ingress job: ${error.message}`);
  return data;
}
