import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CANCELLABLE_SCAN_STATUSES,
  isProductionReviewCancellable,
  isScanCancellationTerminal,
} from "@/lib/review/production-review-cancellable";
import { markScanJobCancelled } from "@/server/jobs/scan-job-store";
import { logScanExecutionTrace } from "@/server/jobs/scan-execution/scan-execution-trace";
import { emitOperationalEvent } from "@/server/observability/operational-events";
import type { OperationalEventType } from "@/server/observability/types";

export class CancelProductionReviewError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CancelProductionReviewError";
  }
}

export type CancelProductionReviewResult = {
  cancelled: boolean;
  reviewId: string;
  scanJobId: string | null;
  idempotent: boolean;
  status: "cancelled" | "cancelling";
};

type ScanRow = {
  id: string;
  status: string;
  organization_id: string;
  project_id: string;
  repository_id: string;
  progress: number;
  progress_message: string | null;
};

const USER_CANCELLED = "USER_CANCELLED";

async function emitCancelTelemetry(
  admin: SupabaseClient,
  eventType: OperationalEventType,
  input: {
    reviewId: string;
    projectId: string;
    organizationId: string;
    cancelledByUserId?: string | null;
    scanJobId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  console.info({
    component: "production-review-cancel",
    event: eventType,
    reviewId: input.reviewId,
    projectId: input.projectId,
    organizationId: input.organizationId,
    cancelledByUserId: input.cancelledByUserId ?? null,
  });
  await emitOperationalEvent(admin, {
    eventType,
    scanId: input.reviewId,
    projectId: input.projectId,
    organizationId: input.organizationId,
    scanJobId: input.scanJobId,
    failureCode: eventType.includes("failed") ? "CANCEL_FAILED" : USER_CANCELLED,
    metadata: {
      cancelledByUserId: input.cancelledByUserId ?? null,
      reason: USER_CANCELLED,
      ...input.metadata,
    },
  }).catch(() => undefined);
}

async function recordCancelAudit(
  admin: SupabaseClient,
  input: {
    reviewId: string;
    projectId: string;
    organizationId: string;
    cancelledByUserId?: string | null;
    scanJobId?: string | null;
  }
): Promise<void> {
  await admin.from("scan_job_events").insert({
    event_type: "production_review_user_cancelled",
    scan_id: input.reviewId,
    project_id: input.projectId,
    organization_id: input.organizationId,
    scan_job_id: input.scanJobId ?? null,
    metadata: {
      reason: USER_CANCELLED,
      cancelledByUserId: input.cancelledByUserId ?? null,
    },
  });
}

async function loadScan(
  admin: SupabaseClient,
  reviewId: string,
  projectId: string
): Promise<ScanRow | null> {
  const { data } = await admin
    .from("scans")
    .select(
      "id, status, organization_id, project_id, repository_id, progress, progress_message"
    )
    .eq("id", reviewId)
    .eq("repository_id", projectId)
    .maybeSingle();
  return (data as ScanRow | null) ?? null;
}

async function finalizeCancelledScan(
  admin: SupabaseClient,
  input: {
    reviewId: string;
    projectId: string;
    organizationId: string;
    cancelledByUserId?: string | null;
    progressAtCancellation: number;
    lastCompletedPhase: string | null;
    scanJobId?: string | null;
  }
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("scans")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_by: input.cancelledByUserId ?? null,
      cancellation_reason: USER_CANCELLED,
      progress_at_cancellation: input.progressAtCancellation,
      last_completed_phase: input.lastCompletedPhase,
      progress_message: "cancelled",
      error_code: USER_CANCELLED,
      error_message: "Review cancelled by user",
      failed_at: now,
    })
    .eq("id", input.reviewId)
    .eq("repository_id", input.projectId)
    .in("status", ["cancelling", ...CANCELLABLE_SCAN_STATUSES])
    .select("id")
    .maybeSingle();

  if (!data) {
    const existing = await loadScan(admin, input.reviewId, input.projectId);
    return existing?.status === "cancelled";
  }

  await emitCancelTelemetry(admin, "production_review_cancel_completed", input);
  await recordCancelAudit(admin, input);
  logScanExecutionTrace("review_cancelled", {
    reviewId: input.reviewId,
    projectId: input.projectId,
    organizationId: input.organizationId,
    status: "cancelled",
    stage: "user_cancelled",
  });
  return true;
}

async function finalizeCancelledScanLegacy(
  admin: SupabaseClient,
  input: {
    reviewId: string;
    projectId: string;
    organizationId: string;
    cancelledByUserId?: string | null;
    scanJobId?: string | null;
  }
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("scans")
    .update({
      status: "cancelled",
      failed_at: now,
      error_code: USER_CANCELLED,
      error_message: "Review cancelled by user",
      progress_message: "cancelled",
    })
    .eq("id", input.reviewId)
    .eq("repository_id", input.projectId)
    .in("status", ["cancelling", ...CANCELLABLE_SCAN_STATUSES])
    .select("id")
    .maybeSingle();

  if (!data) {
    const existing = await loadScan(admin, input.reviewId, input.projectId);
    return existing?.status === "cancelled";
  }

  await emitCancelTelemetry(admin, "production_review_cancel_completed", input);
  await recordCancelAudit(admin, input);
  logScanExecutionTrace("review_cancelled", {
    reviewId: input.reviewId,
    projectId: input.projectId,
    organizationId: input.organizationId,
    status: "cancelled",
    stage: "user_cancelled",
  });
  return true;
}

async function signalAndFinalizeCancellation(
  admin: SupabaseClient,
  input: {
    reviewId: string;
    projectId: string;
    organizationId: string;
    cancelledByUserId?: string | null;
    progressAtCancellation: number;
    lastCompletedPhase: string | null;
    scanJobId: string | null;
    previousStatus: string;
  }
): Promise<CancelProductionReviewResult> {
  await admin
    .from("repository_scan_state")
    .update({ active_scan_id: null })
    .eq("repository_id", input.projectId)
    .eq("active_scan_id", input.reviewId);

  if (input.scanJobId) {
    await emitCancelTelemetry(admin, "production_review_cancel_started", {
      reviewId: input.reviewId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      cancelledByUserId: input.cancelledByUserId,
      scanJobId: input.scanJobId,
      metadata: { previousStatus: input.previousStatus },
    });
    await markScanJobCancelled(admin, input.scanJobId, {
      failureCode: USER_CANCELLED,
      failureMessage: "Review cancelled by user",
    });
  }

  let finalized = await finalizeCancelledScan(admin, {
    reviewId: input.reviewId,
    projectId: input.projectId,
    organizationId: input.organizationId,
    cancelledByUserId: input.cancelledByUserId,
    progressAtCancellation: input.progressAtCancellation,
    lastCompletedPhase: input.lastCompletedPhase,
    scanJobId: input.scanJobId,
  });

  if (!finalized) {
    finalized = await finalizeCancelledScanLegacy(admin, {
      reviewId: input.reviewId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      cancelledByUserId: input.cancelledByUserId,
      scanJobId: input.scanJobId,
    });
  }

  if (!finalized) {
    await emitCancelTelemetry(admin, "production_review_cancel_failed", {
      reviewId: input.reviewId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      cancelledByUserId: input.cancelledByUserId,
      scanJobId: input.scanJobId,
    });
    throw new CancelProductionReviewError(
      500,
      "CANCEL_REQUEST_FAILED",
      "Could not finalize review cancellation"
    );
  }

  return {
    cancelled: true,
    reviewId: input.reviewId,
    scanJobId: input.scanJobId,
    idempotent: false,
    status: "cancelled",
  };
}

export async function cancelProductionReviewByScanJob(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanJobId: string;
    cancelledByUserId?: string | null;
  }
): Promise<CancelProductionReviewResult> {
  const { data: job } = await admin
    .from("scan_jobs")
    .select("id, scan_id, status, organization_id, project_id")
    .eq("id", input.scanJobId)
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (!job?.scan_id) {
    throw new CancelProductionReviewError(404, "SCAN_NOT_FOUND", "Review not found");
  }

  if (job.status === "cancelled") {
    return {
      cancelled: true,
      reviewId: job.scan_id as string,
      scanJobId: job.id as string,
      idempotent: true,
      status: "cancelled",
    };
  }

  return cancelProductionReview(admin, {
    reviewId: job.scan_id as string,
    projectId: input.projectId,
    cancelledByUserId: input.cancelledByUserId,
    expectedScanJobId: input.scanJobId,
    organizationId: input.organizationId,
  });
}

export async function cancelProductionReview(
  admin: SupabaseClient,
  input: {
    reviewId: string;
    projectId: string;
    cancelledByUserId?: string | null;
    expectedScanJobId?: string | null;
    organizationId?: string;
  }
): Promise<CancelProductionReviewResult> {
  const scan = await loadScan(admin, input.reviewId, input.projectId);
  if (!scan) {
    throw new CancelProductionReviewError(404, "SCAN_NOT_FOUND", "Review not found");
  }

  if (
    input.organizationId &&
    scan.organization_id &&
    input.organizationId !== scan.organization_id
  ) {
    throw new CancelProductionReviewError(404, "SCAN_NOT_FOUND", "Review not found");
  }

  const telemetryBase = {
    reviewId: input.reviewId,
    projectId: input.projectId,
    organizationId: scan.organization_id,
    cancelledByUserId: input.cancelledByUserId,
  };

  if (scan.status === "cancelled") {
    return {
      cancelled: true,
      reviewId: input.reviewId,
      scanJobId: input.expectedScanJobId ?? null,
      idempotent: true,
      status: "cancelled",
    };
  }

  if (scan.status === "completed") {
    throw new CancelProductionReviewError(
      409,
      "SCAN_NOT_CANCELLABLE",
      "This review has already completed"
    );
  }

  if (scan.status === "failed") {
    throw new CancelProductionReviewError(
      409,
      "SCAN_NOT_CANCELLABLE",
      "This review cannot be cancelled"
    );
  }

  const progressAtCancellation = scan.progress ?? 0;
  const lastCompletedPhase = scan.progress_message ?? null;
  const previousStatus = scan.status;

  const { data: job } = await admin
    .from("scan_jobs")
    .select("id, status")
    .eq("scan_id", input.reviewId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let scanJobId = (job?.id as string | undefined) ?? null;

  if (input.expectedScanJobId) {
    if (!scanJobId || scanJobId !== input.expectedScanJobId) {
      const { data: expectedJob } = await admin
        .from("scan_jobs")
        .select("id, scan_id, status")
        .eq("id", input.expectedScanJobId)
        .eq("project_id", input.projectId)
        .maybeSingle();

      if (!expectedJob || expectedJob.scan_id !== input.reviewId) {
        await emitCancelTelemetry(admin, "production_review_cancel_failed", {
          ...telemetryBase,
          scanJobId: input.expectedScanJobId,
          metadata: { reason: "stale_scan_job", uiStale: true },
        });
        throw new CancelProductionReviewError(
          409,
          "STALE_REVIEW",
          "The active review changed before cancellation could complete"
        );
      }

      if (expectedJob.status === "cancelled") {
        return {
          cancelled: true,
          reviewId: input.reviewId,
          scanJobId: input.expectedScanJobId,
          idempotent: true,
          status: "cancelled",
        };
      }

      scanJobId = input.expectedScanJobId;
    }
  }

  if (
    !isProductionReviewCancellable({
      scanStatus: scan.status,
      scanJobStatus: (job?.status as string | undefined) ?? undefined,
    })
  ) {
    throw new CancelProductionReviewError(409, "SCAN_NOT_CANCELLABLE", "Review is not active");
  }

  if (scan.status === "cancelling") {
    await finalizeCancelledScan(admin, {
      ...telemetryBase,
      progressAtCancellation,
      lastCompletedPhase,
      scanJobId,
    });
    return {
      cancelled: true,
      reviewId: input.reviewId,
      scanJobId,
      idempotent: true,
      status: "cancelled",
    };
  }

  await emitCancelTelemetry(admin, "production_review_cancel_requested", {
    ...telemetryBase,
    scanJobId,
    metadata: { previousStatus },
  });

  const { data: marked, error: markingError } = await admin
    .from("scans")
    .update({
      status: "cancelling",
      progress_at_cancellation: progressAtCancellation,
      last_completed_phase: lastCompletedPhase,
      progress_message: "cancelling",
    })
    .eq("id", input.reviewId)
    .eq("repository_id", input.projectId)
    .in("status", [...CANCELLABLE_SCAN_STATUSES])
    .select("id")
    .maybeSingle();

  if (!marked) {
    const latest = await loadScan(admin, input.reviewId, input.projectId);
    if (latest?.status === "cancelled") {
      return {
        cancelled: true,
        reviewId: input.reviewId,
        scanJobId,
        idempotent: true,
        status: "cancelled",
      };
    }
    if (
      latest &&
      isProductionReviewCancellable({
        scanStatus: latest.status,
        scanJobStatus: job?.status as string | undefined,
      })
    ) {
      return signalAndFinalizeCancellation(admin, {
        reviewId: input.reviewId,
        projectId: input.projectId,
        organizationId: scan.organization_id,
        cancelledByUserId: input.cancelledByUserId,
        progressAtCancellation: latest.progress ?? progressAtCancellation,
        lastCompletedPhase: latest.progress_message ?? lastCompletedPhase,
        scanJobId,
        previousStatus: latest.status,
      });
    }
    if (markingError) {
      console.error({
        component: "production-review-cancel",
        event: "cancelling_transition_failed",
        reviewId: input.reviewId,
        message: markingError.message,
      });
    }
    throw new CancelProductionReviewError(409, "SCAN_NOT_CANCELLABLE", "Review is not active");
  }

  return signalAndFinalizeCancellation(admin, {
    reviewId: input.reviewId,
    projectId: input.projectId,
    organizationId: scan.organization_id,
    cancelledByUserId: input.cancelledByUserId,
    progressAtCancellation,
    lastCompletedPhase,
    scanJobId,
    previousStatus,
  });
}
