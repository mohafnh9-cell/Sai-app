import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { INNGEST_EVENTS } from "@/inngest/events";
import { resolveScanSchedulerPlan } from "@/lib/env/scan-scheduler-plan";
import { assertInngestReadyForScanDispatch, mapInngestPlanErrorCode } from "@/lib/env/inngest-config";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import type { ScanJobRow } from "../scan-job-store";
import { executeScanRunJob } from "../run-scan-job";
import type { ScanRunPayload } from "../types";
import { buildInngestScanRunPayload } from "../inngest-payload";
import type { BackgroundScheduler } from "../schedule-scan";
import {
  ENQUEUE_FAILED_CODE,
  failReviewExecution,
} from "./review-lifecycle";
import {
  appendScanJobExecutionTrace,
  logScanExecutionTrace,
} from "./scan-execution-trace";

export class ScanEnqueueError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ScanEnqueueError";
  }
}

function extractInngestEventIds(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const ids = (result as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string");
}

async function persistSchedulerMetadata(
  admin: SupabaseClient,
  jobId: string,
  metadata: Record<string, unknown>
) {
  const { data: job } = await admin.from("scan_jobs").select("metadata").eq("id", jobId).maybeSingle();
  const existing = (job?.metadata as Record<string, unknown> | null) ?? {};
  await admin
    .from("scan_jobs")
    .update({
      metadata: { ...existing, ...metadata },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function sendInngestScanRunEvent(payload: ScanRunPayload): Promise<string[]> {
  assertInngestReadyForScanDispatch();
  const safePayload = buildInngestScanRunPayload(payload);

  console.info({
    component: "scan-job-dispatch",
    event: "scan_job_dispatch_attempted",
    scanJobId: safePayload.scanJobId,
    scanId: safePayload.scanId,
    projectId: safePayload.projectId,
    organizationId: safePayload.organizationId,
    eventName: INNGEST_EVENTS.SCAN_RUN,
    correlationId: safePayload.correlationId ?? null,
  });

  const { inngest } = await import("@/inngest/client");
  const result = await inngest.send({
    name: INNGEST_EVENTS.SCAN_RUN,
    data: safePayload,
  });
  const eventIds = extractInngestEventIds(result);

  if (eventIds.length === 0) {
    console.error({
      component: "scan-job-dispatch",
      event: "scan_job_dispatch_failed",
      scanJobId: safePayload.scanJobId,
      scanId: safePayload.scanId,
      reason: "missing_event_id",
    });
  } else {
    console.info({
      component: "scan-job-dispatch",
      event: "scan_job_dispatch_succeeded",
      scanJobId: safePayload.scanJobId,
      scanId: safePayload.scanId,
      inngestEventId: eventIds[0] ?? null,
      correlationId: safePayload.correlationId ?? null,
    });
  }

  return eventIds;
}

export async function enqueueScanRunExecution(
  admin: SupabaseClient,
  job: ScanJobRow,
  payload: ScanRunPayload,
  options?: {
    scheduler?: BackgroundScheduler;
    commitSha?: string | null;
    awaitInline?: boolean;
  }
): Promise<{ executor: "inngest" | "inline"; inngestEventId?: string | null }> {
  const runPayload = { ...payload, scanJobId: job.id };
  const plan = resolveScanSchedulerPlan(payload.organizationId);

  console.info({
    component: "scan-job-dispatch",
    event: "production_review_requested",
    scanJobId: job.id,
    scanId: payload.scanId,
    projectId: payload.projectId,
    organizationId: payload.organizationId,
    correlationId: payload.correlationId ?? null,
    plannedExecutor: plan.ok ? plan.executor : null,
  });

  logScanExecutionTrace("enqueue_attempt", {
    reviewId: payload.scanId,
    scanJobId: job.id,
    projectId: payload.projectId,
    organizationId: payload.organizationId,
    commitSha: options?.commitSha ?? null,
    scheduler: plan.ok ? plan.executor : plan.configuredMode,
    status: "queued",
    stage: "enqueue_attempt",
  });

  if (!plan.ok) {
    const failureCode = mapInngestPlanErrorCode(plan.code);
    await failReviewExecution(admin, {
      reviewId: payload.scanId,
      projectId: payload.projectId,
      organizationId: payload.organizationId,
      scanJobId: job.id,
      commitSha: options?.commitSha ?? null,
      failureCode,
      failureMessage: plan.message,
      scheduler: plan.configuredMode,
    });
    throw new ScanEnqueueError(failureCode, plan.message);
  }

  await persistSchedulerMetadata(admin, job.id, {
    scheduler: plan.executor,
    configuredSchedulerMode: plan.configuredMode,
    orgFallbackUsed: plan.orgFallbackUsed,
  });

  if (plan.executor === "inngest") {
    let eventIds: string[] = [];
    try {
      eventIds = await sendInngestScanRunEvent(runPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Inngest event send failed";
      await failReviewExecution(admin, {
        reviewId: payload.scanId,
        projectId: payload.projectId,
        organizationId: payload.organizationId,
        scanJobId: job.id,
        commitSha: options?.commitSha ?? null,
        failureCode: ENQUEUE_FAILED_CODE,
        failureMessage: message,
        scheduler: "inngest",
        error: message,
      });
      throw new ScanEnqueueError(ENQUEUE_FAILED_CODE, message);
    }

    if (eventIds.length === 0) {
      const message = "Inngest did not return an event id for scan/run";
      await failReviewExecution(admin, {
        reviewId: payload.scanId,
        projectId: payload.projectId,
        organizationId: payload.organizationId,
        scanJobId: job.id,
        commitSha: options?.commitSha ?? null,
        failureCode: ENQUEUE_FAILED_CODE,
        failureMessage: message,
        scheduler: "inngest",
        error: message,
      });
      throw new ScanEnqueueError(ENQUEUE_FAILED_CODE, message);
    }

    const inngestEventId = eventIds[0] ?? null;
    await persistSchedulerMetadata(admin, job.id, { inngestEventId });
    await appendScanJobExecutionTrace(admin, job.id, {
      stage: "enqueue_accepted",
      at: new Date().toISOString(),
      scheduler: "inngest",
      inngestEventId,
    });

    logScanExecutionTrace("enqueue_accepted", {
      reviewId: payload.scanId,
      scanJobId: job.id,
      projectId: payload.projectId,
      organizationId: payload.organizationId,
      commitSha: options?.commitSha ?? null,
      scheduler: "inngest",
      inngestEventId,
      status: "queued",
      stage: "enqueue_accepted",
    });

    return { executor: "inngest", inngestEventId };
  }

  if (plan.executor === "inline") {
    if (options?.awaitInline) {
      try {
        await executeScanRunJob(createAdminClient(), runPayload, { lockedBy: "inline-worker" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Inline scan execution failed";
        await failReviewExecution(createAdminClient(), {
          reviewId: payload.scanId,
          projectId: payload.projectId,
          organizationId: payload.organizationId,
          scanJobId: job.id,
          commitSha: options?.commitSha ?? null,
          failureCode: ENQUEUE_FAILED_CODE,
          failureMessage: message,
          scheduler: "inline",
          error: message,
          stage: "scan_failed",
        }).catch(() => undefined);
        throw error;
      }

      await appendScanJobExecutionTrace(admin, job.id, {
        stage: "enqueue_accepted",
        at: new Date().toISOString(),
        scheduler: "inline",
        metadata: { awaited: true },
      });

      return { executor: "inline", inngestEventId: null };
    }

    const inlineScheduler =
      options?.scheduler ??
      ((fn: () => void | Promise<void>) => {
        void fn();
      });

    try {
      inlineScheduler(async () => {
        try {
          await executeScanRunJob(createAdminClient(), runPayload, { lockedBy: "inline-worker" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Inline scan execution failed";
          await failReviewExecution(createAdminClient(), {
            reviewId: payload.scanId,
            projectId: payload.projectId,
            organizationId: payload.organizationId,
            scanJobId: job.id,
            commitSha: options?.commitSha ?? null,
            failureCode: ENQUEUE_FAILED_CODE,
            failureMessage: message,
            scheduler: "inline",
            error: message,
            stage: "scan_failed",
          }).catch(() => undefined);
        }
      });
    } catch (error) {
    const message = error instanceof Error ? error.message : "Could not schedule inline scan worker";
    await failReviewExecution(admin, {
      reviewId: payload.scanId,
      projectId: payload.projectId,
      organizationId: payload.organizationId,
      scanJobId: job.id,
      commitSha: options?.commitSha ?? null,
      failureCode: ENQUEUE_FAILED_CODE,
      failureMessage: message,
      scheduler: "inline",
      error: message,
    });
    throw new ScanEnqueueError(ENQUEUE_FAILED_CODE, message);
  }

    await appendScanJobExecutionTrace(admin, job.id, {
      stage: "enqueue_accepted",
      at: new Date().toISOString(),
      scheduler: "inline",
    });

    logScanExecutionTrace("enqueue_accepted", {
      reviewId: payload.scanId,
      scanJobId: job.id,
      projectId: payload.projectId,
      organizationId: payload.organizationId,
      commitSha: options?.commitSha ?? null,
      scheduler: "inline",
      status: "queued",
      stage: "enqueue_accepted",
    });

    return { executor: "inline", inngestEventId: null };
  }

  throw new ScanEnqueueError(ENQUEUE_FAILED_CODE, `Unsupported executor: ${plan.executor}`);
}

export async function reenqueueExistingScanRunJob(
  admin: SupabaseClient,
  job: ScanJobRow,
  payload: ScanRunPayload
): Promise<void> {
  const plan = resolveScanSchedulerPlan(payload.organizationId);
  if (!plan.ok) {
    throw new ScanEnqueueError(mapInngestPlanErrorCode(plan.code), plan.message);
  }

  if (plan.executor === "inngest") {
    const eventIds = await sendInngestScanRunEvent({ ...payload, scanJobId: job.id });
    if (eventIds.length === 0) {
      throw new ScanEnqueueError("enqueue_failed", "Inngest did not return an event id for scan/run");
    }
    await persistSchedulerMetadata(admin, job.id, {
      scheduler: "inngest",
      inngestEventId: eventIds[0],
    });
    return;
  }

  await executeScanRunJob(admin, { ...payload, scanJobId: job.id }, { lockedBy: "recovery-inline" });
}
