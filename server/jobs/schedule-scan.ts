import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { INNGEST_EVENTS } from "@/inngest/events";
import {
  assertInngestSchedulerConfigured,
  getScanSchedulerMode,
  isInngestEnabledForOrganization,
} from "@/lib/env/scan-scheduler";
import { resolveScanSchedulerPlan } from "@/lib/env/scan-scheduler-plan";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { createScanJob } from "./scan-job-store";
import type { ScanJobType, ScanRunPayload, WebhookProcessPayload } from "./types";
import { processGitHubWebhookEvent } from "@/server/github-automation/orchestrator";
import {
  buildInngestScanRunPayload,
  buildInngestWebhookProcessPayload,
  extractWebhookMetadata,
  rehydrateWebhookProcessPayload,
} from "./inngest-payload";
import {
  enqueueScanRunExecution,
  ScanEnqueueError,
} from "./scan-execution/enqueue-scan-run";
import { logScanExecutionTrace } from "./scan-execution/scan-execution-trace";
import {
  executeLegacyInlineScanRun,
  isScanJobsInfrastructureMissing,
} from "./legacy-inline-scan-run";
import {
  assertScanJobsAvailableOrThrow,
} from "./scan-job-infrastructure";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "schedule-scan", event, ...fields });
}

function logSchedulerResolution(organizationId: string) {
  const plan = resolveScanSchedulerPlan(organizationId);
  log("scan_scheduler_resolved", {
    organizationId,
    configuredMode: plan.ok ? plan.configuredMode : plan.configuredMode,
    executor: plan.ok ? plan.executor : null,
    allowlistApplied: plan.ok ? plan.allowlistApplied : false,
    orgFallbackUsed: plan.ok ? plan.orgFallbackUsed : false,
    planOk: plan.ok,
    planError: plan.ok ? null : plan.message,
    envScanScheduler: getScanSchedulerMode(),
  });
  return plan;
}

export type BackgroundScheduler = (fn: () => void | Promise<void>) => void;

const defaultScheduler: BackgroundScheduler = (fn) => {
  after(fn);
};

/**
 * Inline scans run inside Vercel `after()` continuations. Keep scan work within
 * SCAN_JOB_TIMEOUT_MS (15m) — longer runs require SCAN_SCHEDULER=inngest.
 */
async function sendInngestEvent<T extends Record<string, unknown>>(
  name: string,
  data: T
): Promise<void> {
  assertInngestSchedulerConfigured();
  const { inngest } = await import("@/inngest/client");
  const result = await inngest.send({ name, data });
  const ids = (result as { ids?: string[] } | null)?.ids ?? [];
  if (ids.length === 0) {
    throw new ScanEnqueueError("enqueue_failed", `Inngest did not accept event ${name}`);
  }
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

  let job: Awaited<ReturnType<typeof createScanJob>>["job"];
  let duplicate: boolean;
  try {
    const created = await createScanJob(admin, {
      organizationId: payload.organizationId,
      projectId: payload.projectId,
      scanId: payload.scanId,
      jobType,
      metadata: {
        scanType: payload.scanType ?? "full",
        branch: payload.branch ?? null,
        headCommitSha: payload.headCommitSha ?? null,
        finalizeKind: payload.finalize?.kind ?? null,
        userId: payload.userId,
        persistMode: payload.persistMode ?? null,
        finalize: payload.finalize ?? null,
      },
    });
    job = created.job;
    duplicate = created.duplicate;
  } catch (error) {
    assertScanJobsAvailableOrThrow({
      error,
      organizationId: payload.organizationId,
      projectId: payload.projectId,
      scanId: payload.scanId,
    });
    if (isScanJobsInfrastructureMissing(error)) {
      const inlineScheduler = options?.scheduler ?? defaultScheduler;
      inlineScheduler(() => {
        void executeLegacyInlineScanRun(createAdminClient(), payload).catch((runError) => {
          console.error({
            component: "legacy-inline-scan-run",
            event: "execution_failed",
            scanId: payload.scanId,
            message: runError instanceof Error ? runError.message : String(runError),
          });
        });
      });
      return { scanJobId: "", duplicate: false };
    }
    throw error;
  }

  if (duplicate || !job) {
    return { scanJobId: job?.id ?? payload.scanJobId, duplicate: true };
  }

  const runPayload = { ...payload, scanJobId: job.id };
  const plan = logSchedulerResolution(payload.organizationId);

  logScanExecutionTrace("review_created", {
    reviewId: payload.scanId,
    scanJobId: job.id,
    projectId: payload.projectId,
    organizationId: payload.organizationId,
    commitSha: payload.headCommitSha ?? payload.baseCommitSha ?? null,
    scheduler: plan.ok ? plan.executor : plan.configuredMode,
    status: "queued",
    stage: "review_created",
  });

  try {
    const enqueued = await enqueueScanRunExecution(admin, job, runPayload, {
      scheduler: options?.scheduler ?? defaultScheduler,
      commitSha: payload.headCommitSha ?? payload.baseCommitSha ?? null,
    });
    log("scan_enqueued", {
      scanJobId: job.id,
      scanId: payload.scanId,
      organizationId: payload.organizationId,
      projectId: payload.projectId,
      executor: enqueued.executor,
      inngestEventId: enqueued.inngestEventId ?? null,
    });
  } catch (error) {
    if (error instanceof ScanEnqueueError) {
      log("scan_enqueue_failed", {
        scanJobId: job.id,
        scanId: payload.scanId,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    throw error;
  }

  return { scanJobId: job.id, duplicate: false };
}

export async function scheduleWebhookProcessing(input: {
  deliveryId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  organizationId: string;
}): Promise<{ scanJobId: string | null; duplicate: boolean }> {
  const admin = createAdminClient();
  logSchedulerResolution(input.organizationId);

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
        INNGEST_EVENTS.GITHUB_WEBHOOK_PROCESS,
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
      INNGEST_EVENTS.GITHUB_WEBHOOK_PROCESS,
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
  return scheduleScanRun(admin, payload, {
    scheduler: options?.scheduler,
    jobType: payload.jobType,
  });
}
