import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isActiveReviewScanStatus } from "@/brain/automatic-review/review-status";
import {
  appendScanJobExecutionTrace,
  logScanExecutionTrace,
} from "./scan-execution-trace";

export const ENQUEUE_FAILED_CODE = "enqueue_failed";

const ACTIVE_SCAN_STATUSES = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
] as const;

export async function failReviewExecution(
  admin: SupabaseClient,
  input: {
    reviewId: string;
    projectId: string;
    organizationId: string;
    scanJobId?: string | null;
    commitSha?: string | null;
    failureCode: string;
    failureMessage: string;
    stage?: "enqueue_failed" | "scan_failed";
    scheduler?: string | null;
    error?: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("scans")
    .update({
      status: "failed",
      failed_at: now,
      error_code: input.failureCode,
      error_message: input.failureMessage,
      progress_message: "Review could not be executed",
    })
    .eq("id", input.reviewId)
    .in("status", [...ACTIVE_SCAN_STATUSES]);

  await admin
    .from("repository_scan_state")
    .update({ active_scan_id: null })
    .eq("repository_id", input.projectId)
    .eq("active_scan_id", input.reviewId);

  if (input.scanJobId) {
    await admin
      .from("scan_jobs")
      .update({
        status: "failed",
        failure_code: input.failureCode,
        failure_message: input.failureMessage,
        failed_at: now,
        updated_at: now,
      })
      .eq("id", input.scanJobId)
      .in("status", ["queued", "running"]);

    await appendScanJobExecutionTrace(admin, input.scanJobId, {
      stage: input.stage ?? "enqueue_failed",
      at: now,
      scheduler: (input.scheduler as "inline" | "inngest" | null) ?? null,
      error: input.error ?? input.failureMessage,
    });
  }

  logScanExecutionTrace("review_execution_failed", {
    reviewId: input.reviewId,
    scanJobId: input.scanJobId,
    projectId: input.projectId,
    organizationId: input.organizationId,
    commitSha: input.commitSha,
    scheduler: input.scheduler,
    status: "failed",
    error: input.error ?? input.failureMessage,
    stage: input.stage ?? "enqueue_failed",
  });
}

export async function beginReviewProcessing(
  admin: SupabaseClient,
  input: {
    reviewId: string;
    scanJobId?: string | null;
    organizationId?: string;
    projectId?: string;
    commitSha?: string | null;
    scheduler?: string | null;
  }
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("scans")
    .update({
      status: "fetching_repository",
      progress: 5,
      progress_message: "Fetching repository metadata",
      started_at: now,
      processing_started_at: now,
    })
    .eq("id", input.reviewId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();

  if (!data) return false;

  if (input.scanJobId) {
    await appendScanJobExecutionTrace(admin, input.scanJobId, {
      stage: "worker_started",
      at: now,
      scheduler: (input.scheduler as "inline" | "inngest" | null) ?? null,
    });
  }

  logScanExecutionTrace("review_processing_started", {
    reviewId: input.reviewId,
    scanJobId: input.scanJobId,
    projectId: input.projectId,
    organizationId: input.organizationId,
    commitSha: input.commitSha,
    scheduler: input.scheduler,
    status: "fetching_repository",
    stage: "worker_started",
  });

  return true;
}

export async function cancelReviewExecution(
  admin: SupabaseClient,
  input: {
    reviewId: string;
    projectId: string;
    cancelledByUserId?: string | null;
  }
): Promise<{ cancelled: boolean; idempotent?: boolean }> {
  const { cancelProductionReview } = await import(
    "@/server/review-cancel/cancel-production-review"
  );
  const result = await cancelProductionReview(admin, input);
  return { cancelled: result.cancelled, idempotent: result.idempotent };
}

export async function syncScanFailureFromJob(
  admin: SupabaseClient,
  scanJobId: string,
  input: { failureCode: string; failureMessage: string }
): Promise<void> {
  const { data: job } = await admin
    .from("scan_jobs")
    .select("scan_id, project_id, organization_id, metadata")
    .eq("id", scanJobId)
    .maybeSingle();
  if (!job?.scan_id) return;

  const reviewId = job.scan_id as string;
  const { data: scan } = await admin.from("scans").select("status").eq("id", reviewId).maybeSingle();
  if (!scan?.status || !isActiveReviewScanStatus(scan.status as string)) return;

  const projectId = (job.project_id as string | null) ?? reviewId;
  await failReviewExecution(admin, {
    reviewId,
    projectId,
    organizationId: job.organization_id as string,
    scanJobId,
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
    stage: "scan_failed",
    scheduler: (job.metadata as { scheduler?: string } | null)?.scheduler ?? null,
  });
}
