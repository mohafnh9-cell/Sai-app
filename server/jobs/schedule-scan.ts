import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertInngestSchedulerConfigured,
  getScanSchedulerMode,
  isInngestEnabledForOrganization,
} from "@/lib/env/scan-scheduler";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { createScanJob } from "./scan-job-store";
import { executeScanRunJob } from "./run-scan-job";
import type { ScanJobType, ScanRunPayload, WebhookProcessPayload } from "./types";
import { processGitHubWebhookEvent } from "@/server/github-automation/orchestrator";
import {
  buildInngestScanRunPayload,
  buildInngestWebhookProcessPayload,
  extractWebhookMetadata,
  rehydrateWebhookProcessPayload,
} from "./inngest-payload";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "schedule-scan", event, ...fields });
}

export type BackgroundScheduler = (fn: () => void | Promise<void>) => void;

const defaultScheduler: BackgroundScheduler = (fn) => {
  after(fn);
};

async function sendInngestEvent<T extends Record<string, unknown>>(
  name: string,
  data: T
): Promise<void> {
  assertInngestSchedulerConfigured();
  const { inngest } = await import("@/inngest/client");
  await inngest.send({ name, data });
}

export async function scheduleScanRun(
  admin: SupabaseClient,
  payload: ScanRunPayload,
  options?: { scheduler?: BackgroundScheduler; jobType?: ScanJobType }
): Promise<{ scanJobId: string; duplicate: boolean }> {
  const jobType =
    options?.jobType ??
    payload.jobType ??
    (payload.persistMode === "review_only" ? "automatic_review" : "manual_scan");

  const { job, duplicate } = await createScanJob(admin, {
    organizationId: payload.organizationId,
    projectId: payload.projectId,
    scanId: payload.scanId,
    jobType,
    metadata: {
      scanType: payload.scanType ?? "full",
      branch: payload.branch ?? null,
      finalizeKind: payload.finalize?.kind ?? null,
      userId: payload.userId,
      persistMode: payload.persistMode ?? null,
      finalize: payload.finalize ?? null,
    },
  });

  if (duplicate || !job) {
    return { scanJobId: job?.id ?? payload.scanJobId, duplicate: true };
  }

  const runPayload = { ...payload, scanJobId: job.id };

  if (isInngestEnabledForOrganization(payload.organizationId)) {
    await sendInngestEvent("scan/run", buildInngestScanRunPayload(runPayload));
    log("scan_enqueued_inngest", {
      scanJobId: job.id,
      scanId: payload.scanId,
      organizationId: payload.organizationId,
      projectId: payload.projectId,
    });
    return { scanJobId: job.id, duplicate: false };
  }

  const scheduler = options?.scheduler ?? defaultScheduler;
  scheduler(() =>
    executeScanRunJob(createAdminClient(), runPayload).catch((error) => {
      log("inline_scan_failed", {
        scanJobId: job.id,
        scanId: payload.scanId,
        message: error instanceof Error ? error.message : String(error),
      });
    })
  );

  log("scan_enqueued_inline", {
    scanJobId: job.id,
    scanId: payload.scanId,
    organizationId: payload.organizationId,
    projectId: payload.projectId,
    scheduler: getScanSchedulerMode(),
  });

  return { scanJobId: job.id, duplicate: false };
}

export async function scheduleWebhookProcessing(input: {
  deliveryId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  organizationId: string;
}): Promise<{ scanJobId: string | null; duplicate: boolean }> {
  const admin = createAdminClient();

  if (input.deliveryId) {
    const { job, duplicate } = await createScanJob(admin, {
      organizationId: input.organizationId,
      githubDeliveryId: input.deliveryId,
      jobType: "webhook_process",
      metadata: {
        eventType: input.eventType,
        deliveryId: input.deliveryId,
        webhookPayload: input.payload,
        ...extractWebhookMetadata(input.payload),
      },
    });

    if (duplicate || !job) {
      return { scanJobId: null, duplicate: true };
    }

    const processPayload: WebhookProcessPayload = {
      scanJobId: job.id,
      deliveryId: input.deliveryId,
      eventType: input.eventType,
      payload: input.payload,
    };

    if (isInngestEnabledForOrganization(input.organizationId)) {
      await sendInngestEvent(
        "github/webhook.process",
        buildInngestWebhookProcessPayload(job.id)
      );
      log("webhook_enqueued_inngest", {
        scanJobId: job.id,
        deliveryId: input.deliveryId,
        eventType: input.eventType,
      });
      return { scanJobId: job.id, duplicate: false };
    }

    defaultScheduler(() =>
      processWebhookJob(createAdminClient(), processPayload).catch((error) => {
        log("inline_webhook_failed", {
          scanJobId: job.id,
          deliveryId: input.deliveryId,
          message: error instanceof Error ? error.message : String(error),
        });
      })
    );

    return { scanJobId: job.id, duplicate: false };
  }

  if (isInngestEnabledForOrganization(input.organizationId)) {
    const { job } = await createScanJob(admin, {
      organizationId: input.organizationId,
      jobType: "webhook_process",
      metadata: {
        eventType: input.eventType,
        noDeliveryId: true,
        webhookPayload: input.payload,
        ...extractWebhookMetadata(input.payload),
      },
    });
    if (!job) return { scanJobId: null, duplicate: false };
    await sendInngestEvent(
      "github/webhook.process",
      buildInngestWebhookProcessPayload(job.id)
    );
    return { scanJobId: job.id, duplicate: false };
  }

  defaultScheduler(() => {
    void processGitHubWebhookEvent({
      eventType: input.eventType,
      deliveryId: input.deliveryId,
      payload: input.payload,
    }).catch((error) => {
      log("inline_webhook_failed", {
        deliveryId: input.deliveryId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  return { scanJobId: null, duplicate: false };
}

export async function processWebhookJob(
  admin: SupabaseClient,
  payload: WebhookProcessPayload | { scanJobId: string }
): Promise<void> {
  const { markScanJobRunning, markScanJobCompleted, markScanJobFailed, getScanJob } = await import(
    "./scan-job-store"
  );

  const resolvedPayload =
    "payload" in payload && payload.payload
      ? payload
      : rehydrateWebhookProcessPayload(
          payload.scanJobId,
          (await getScanJob(admin, payload.scanJobId))?.metadata
        );

  const running = await markScanJobRunning(admin, resolvedPayload.scanJobId);
  if (!running.updated) {
    const existing = await getScanJob(admin, resolvedPayload.scanJobId);
    if (existing && (existing.status === "completed" || existing.status === "failed")) {
      return;
    }
  }

  try {
    await processGitHubWebhookEvent({
      eventType: resolvedPayload.eventType,
      deliveryId: resolvedPayload.deliveryId,
      payload: resolvedPayload.payload,
    });
    const completed = await markScanJobCompleted(admin, resolvedPayload.scanJobId);
    if (!completed.updated) {
      log("webhook_job_already_terminal", { scanJobId: resolvedPayload.scanJobId });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    await markScanJobFailed(admin, resolvedPayload.scanJobId, {
      failureCode: "WEBHOOK_PROCESS_FAILED",
      failureMessage: message,
    });
    throw error;
  }
}

export async function scheduleAutomationScan(
  admin: SupabaseClient,
  payload: ScanRunPayload & { jobType: "webhook_push_scan" | "webhook_pr_scan" | "automatic_review" },
  options?: { scheduler?: BackgroundScheduler }
): Promise<{ scanJobId: string; duplicate: boolean }> {
  const { job, duplicate } = await createScanJob(admin, {
    organizationId: payload.organizationId,
    projectId: payload.projectId,
    scanId: payload.scanId,
    jobType: payload.jobType,
    metadata: {
      scanType: payload.scanType ?? "full",
      branch: payload.branch ?? null,
      finalizeKind: payload.finalize?.kind ?? null,
      userId: payload.userId,
      persistMode: payload.persistMode ?? null,
      finalize: payload.finalize ?? null,
    },
  });

  if (duplicate || !job) {
    return { scanJobId: job?.id ?? payload.scanJobId, duplicate: true };
  }

  const runPayload = { ...payload, scanJobId: job.id };

  if (isInngestEnabledForOrganization(payload.organizationId)) {
    await sendInngestEvent("scan/run", buildInngestScanRunPayload(runPayload));
    return { scanJobId: job.id, duplicate: false };
  }

  const scheduler = options?.scheduler ?? defaultScheduler;
  scheduler(() =>
    executeScanRunJob(createAdminClient(), runPayload).catch((error) => {
      log("inline_automation_scan_failed", {
        scanJobId: job.id,
        scanId: payload.scanId,
        message: error instanceof Error ? error.message : String(error),
      });
    })
  );

  return { scanJobId: job.id, duplicate: false };
}
