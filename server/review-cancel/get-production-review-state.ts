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
import { COMMIT_SUPERSEDED_CODE } from "@/server/review-start/release-active-review-for-new-head";
import { reconcileOrphanScanJobWithTerminalScan } from "@/server/jobs/reconcile-orphan-scan-job";

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
    console.warn({
      component: "production-review-state",
      event: "scan_jobs_query_failed",
      projectId: input.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
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
      let jobStatus = String(activeJob.status ?? "");
      let wasOrphanedJob = false;

      if (
        (jobStatus === "queued" || jobStatus === "running") &&
        ["completed", "failed", "cancelled"].includes(scanStatus)
      ) {
        wasOrphanedJob = true;
        await reconcileOrphanScanJobWithTerminalScan(admin, {
          jobId: activeJob.id as string,
          scan: scan as Record<string, unknown>,
        }).catch(() => undefined);
        const { data: refreshedJob } = await admin
          .from("scan_jobs")
          .select("id, status")
          .eq("id", activeJob.id as string)
          .maybeSingle();
        if (refreshedJob?.status) {
          jobStatus = String(refreshedJob.status);
        }
      }

      // An orphaned job (stuck queued/running while its scan already
      // finished) can be arbitrarily old and unrelated to the project's
      // actual current scan — reconciling it fixes scan_jobs bookkeeping,
      // but its scan must not be reported as "the" review state. Fall
      // through to the repository_scan_state / latest-scan lookups below,
      // which track the real current scan.
      if (!wasOrphanedJob) {
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
          status: uiStatus,
          hasActiveReview: true,
          isCancellable: isProductionReviewCancellable({ scanStatus }),
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

  const { data: latestCompleted } = await admin
    .from("scans")
    .select(
      "id, status, commit_sha, created_at, started_at, completed_at, cancelled_at, error_message, progress_message"
    )
    .eq("repository_id", input.projectId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestCompleted) {
    return buildState({
      scan: latestCompleted,
      status: "completed",
      hasActiveReview: false,
      isCancellable: false,
    });
  }

  return idleState();
}
