import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mapScanStatusToProductionReviewUiStatus,
  type ProductionReviewState,
  type ProductionReviewUiStatus,
} from "@/lib/review/production-review-state";
import { isProductionReviewCancellable } from "@/lib/review/production-review-cancellable";
import { isActiveReviewScanStatus } from "@/brain/automatic-review/review-status";
import {
  expireStaleActiveReviewsForRepository,
  isStaleActiveReviewScan,
  REVIEW_STALE_FAILURE_CODE,
} from "@/server/review-recovery/stale-review";
import { isScanJobsInfrastructureMissing } from "@/server/jobs/legacy-inline-scan-run";
import { COMMIT_SUPERSEDED_CODE } from "@/server/review-start/release-active-review-for-new-head";

function idleState(): ProductionReviewState {
  return {
    hasActiveReview: false,
    scanId: null,
    scanJobId: null,
    status: "idle",
    isCancellable: false,
    commitSha: null,
    createdAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    failureMessage: null,
  };
}

function buildState(input: {
  scan: Record<string, unknown>;
  job?: Record<string, unknown> | null;
  status: ProductionReviewUiStatus;
  hasActiveReview: boolean;
  isCancellable: boolean;
  failureMessage?: string | null;
}): ProductionReviewState {
  const scan = input.scan;
  return {
    hasActiveReview: input.hasActiveReview,
    scanId: scan.id as string,
    scanJobId: (input.job?.id as string | undefined) ?? null,
    status: input.status,
    isCancellable: input.isCancellable,
    commitSha: (scan.commit_sha as string | null) ?? null,
    createdAt: (scan.created_at as string | null) ?? null,
    startedAt:
      (input.job?.started_at as string | null) ??
      (scan.started_at as string | null) ??
      null,
    completedAt: (scan.completed_at as string | null) ?? null,
    cancelledAt: (scan.cancelled_at as string | null) ?? null,
    failureMessage:
      input.failureMessage ??
      (scan.error_message as string | null) ??
      (scan.progress_message as string | null) ??
      null,
  };
}

export async function getProductionReviewState(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string; recoverStale?: boolean }
): Promise<ProductionReviewState> {
  if (input.recoverStale !== false) {
    await expireStaleActiveReviewsForRepository(admin, input.projectId).catch(() => undefined);
  }

  let activeJob: Record<string, unknown> | null = null;
  try {
    const { data } = await admin
      .from("scan_jobs")
      .select(
        "id, scan_id, status, created_at, started_at, heartbeat_at, updated_at, failure_message"
      )
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    activeJob = (data as Record<string, unknown> | null) ?? null;
  } catch (error) {
    if (!isScanJobsInfrastructureMissing(error)) {
      throw error;
    }
  }

  if (activeJob?.scan_id) {
    const { data: scan } = await admin
      .from("scans")
      .select(
        "id, status, commit_sha, created_at, started_at, completed_at, cancelled_at, error_message, progress_message, updated_at, queued_at"
      )
      .eq("id", activeJob.scan_id as string)
      .eq("repository_id", input.projectId)
      .maybeSingle();

    if (scan) {
      const scanStatus = String(scan.status ?? "");
      const jobStatus = String(activeJob.status ?? "");
      let uiStatus = mapScanStatusToProductionReviewUiStatus(scanStatus);
      let failureMessage: string | null = null;

      if (
        isStaleActiveReviewScan({
          status: scanStatus,
          created_at: scan.created_at as string,
          updated_at: scan.updated_at as string,
          started_at: scan.started_at as string | null,
          queued_at: scan.queued_at as string | null,
        })
      ) {
        uiStatus = "stale";
        failureMessage = "Review timed out";
      }

      const terminal = ["cancelled", "completed", "failed", "stale"].includes(uiStatus);
      const hasActiveReview = !terminal && uiStatus !== "idle";
      const isCancellable =
        hasActiveReview &&
        uiStatus !== "cancelling" &&
        isProductionReviewCancellable({
          scanStatus,
          scanJobStatus: jobStatus,
        });

      return buildState({
        scan,
        job: activeJob,
        status: uiStatus,
        hasActiveReview,
        isCancellable,
        failureMessage,
      });
    }
  }

  const { data: scanState } = await admin
    .from("repository_scan_state")
    .select("active_scan_id")
    .eq("repository_id", input.projectId)
    .maybeSingle();

  const activeScanId = scanState?.active_scan_id as string | null | undefined;
  if (activeScanId) {
    const { data: scan } = await admin
      .from("scans")
      .select(
        "id, status, commit_sha, created_at, started_at, completed_at, cancelled_at, error_message, progress_message, updated_at, queued_at"
      )
      .eq("id", activeScanId)
      .eq("repository_id", input.projectId)
      .maybeSingle();

    if (scan) {
      const scanStatus = String(scan.status ?? "");
      const uiStatus = mapScanStatusToProductionReviewUiStatus(scanStatus);

      if (uiStatus === "cancelled" || uiStatus === "completed" || uiStatus === "failed") {
        return buildState({
          scan,
          status: uiStatus,
          hasActiveReview: false,
          isCancellable: false,
        });
      }

      if (isActiveReviewScanStatus(scanStatus)) {
        const stale = isStaleActiveReviewScan({
          status: scanStatus,
          created_at: scan.created_at as string,
          updated_at: scan.updated_at as string,
          started_at: scan.started_at as string | null,
          queued_at: scan.queued_at as string | null,
        });
        if (stale) {
          return buildState({
            scan,
            status: "stale",
            hasActiveReview: false,
            isCancellable: false,
            failureMessage: "Review timed out",
          });
        }

        return buildState({
          scan,
          status: "idle",
          hasActiveReview: false,
          isCancellable: false,
          failureMessage: null,
        });
      }
    }
  }

  const { data: latestTerminal } = await admin
    .from("scans")
    .select(
      "id, status, commit_sha, created_at, started_at, completed_at, cancelled_at, error_message, error_code, progress_message"
    )
    .eq("repository_id", input.projectId)
    .in("status", ["cancelled", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestTerminal) {
    const terminalCode = latestTerminal.error_code as string | null;
    if (terminalCode === COMMIT_SUPERSEDED_CODE) {
      return idleState();
    }
    const uiStatus = mapScanStatusToProductionReviewUiStatus(String(latestTerminal.status));
    if (uiStatus === "cancelled" || uiStatus === "failed") {
      return buildState({
        scan: latestTerminal,
        status: uiStatus,
        hasActiveReview: false,
        isCancellable: false,
        failureMessage:
          latestTerminal.error_code === REVIEW_STALE_FAILURE_CODE
            ? "Review timed out"
            : (latestTerminal.error_message as string | null),
      });
    }
  }

  return idleState();
}
