import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isActiveReviewScanStatus } from "@/brain/automatic-review/review-status";
import {
  CANCELLABLE_SCAN_STATUSES,
  isCancellableScanStatus,
  isScanCancellationTerminal,
} from "@/lib/review/cancellation";
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
      progress_message: "Production review cancelled",
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

export async function cancelProductionReview(
  admin: SupabaseClient,
  input: {
    reviewId: string;
    projectId: string;
    cancelledByUserId?: string | null;
  }
): Promise<CancelProductionReviewResult> {
  const scan = await loadScan(admin, input.reviewId, input.projectId);
  if (!scan) {
    throw new CancelProductionReviewError(404, "REVIEW_NOT_FOUND", "Review not found");
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
      idempotent: true,
      status: "cancelled",
    };
  }

  if (scan.status === "completed") {
    throw new CancelProductionReviewError(
      409,
      "ALREADY_COMPLETED",
      "This review has already completed"
    );
  }

  if (scan.status === "failed") {
    throw new CancelProductionReviewError(409, "NOT_CANCELLABLE", "This review cannot be cancelled");
  }

  const progressAtCancellation = scan.progress ?? 0;
  const lastCompletedPhase = scan.progress_message ?? null;

  const { data: job } = await admin
    .from("scan_jobs")
    .select("id")
    .eq("scan_id", input.reviewId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const scanJobId = (job?.id as string | undefined) ?? null;

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
      idempotent: true,
      status: "cancelled",
    };
  }

  if (!isCancellableScanStatus(scan.status) && !isActiveReviewScanStatus(scan.status)) {
    throw new CancelProductionReviewError(409, "NOT_CANCELLABLE", "Review is not active");
  }

  await emitCancelTelemetry(admin, "production_review_cancel_requested", {
    ...telemetryBase,
    scanJobId,
  });

  const now = new Date().toISOString();
  const { data: marked } = await admin
    .from("scans")
    .update({
      status: "cancelling",
      progress_at_cancellation: progressAtCancellation,
      last_completed_phase: lastCompletedPhase,
      progress_message: "Cancelling production review",
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
        idempotent: true,
        status: "cancelled",
      };
    }
    if (isScanCancellationTerminal(latest?.status)) {
      await finalizeCancelledScan(admin, {
        ...telemetryBase,
        progressAtCancellation: latest?.progress ?? progressAtCancellation,
        lastCompletedPhase: latest?.progress_message ?? lastCompletedPhase,
        scanJobId,
      });
      return {
        cancelled: true,
        reviewId: input.reviewId,
        idempotent: true,
        status: "cancelled",
      };
    }
    throw new CancelProductionReviewError(409, "NOT_CANCELLABLE", "Review is not active");
  }

  await emitCancelTelemetry(admin, "production_review_cancel_started", {
    ...telemetryBase,
    scanJobId,
  });

  await admin
    .from("repository_scan_state")
    .update({ active_scan_id: null })
    .eq("repository_id", input.projectId)
    .eq("active_scan_id", input.reviewId);

  if (scanJobId) {
    await markScanJobCancelled(admin, scanJobId, {
      failureCode: USER_CANCELLED,
      failureMessage: "Review cancelled by user",
    });
  }

  const finalized = await finalizeCancelledScan(admin, {
    ...telemetryBase,
    progressAtCancellation,
    lastCompletedPhase,
    scanJobId,
  });

  if (!finalized) {
    await emitCancelTelemetry(admin, "production_review_cancel_failed", {
      ...telemetryBase,
      scanJobId,
    });
    throw new CancelProductionReviewError(
      500,
      "CANCEL_FAILED",
      "Could not finalize review cancellation"
    );
  }

  return {
    cancelled: true,
    reviewId: input.reviewId,
    idempotent: false,
    status: "cancelled",
  };
}
