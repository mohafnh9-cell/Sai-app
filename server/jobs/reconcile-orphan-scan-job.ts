import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getScanJob,
  markScanJobCancelled,
  markScanJobCompleted,
  markScanJobFailed,
} from "./scan-job-store";
import { isTerminalScanJobStatus } from "./job-transitions";
import { executeScanRunJob } from "./run-scan-job";
import { ensureProductionVerdictForCompletedScan } from "@/server/production-verdict/ensure-verdict-for-scan";
import { buildScanRunPayloadFromRow } from "./kick-stuck-scan-run";
import type { ScanRunPayload } from "./types";

const SCAN_RUN_JOB_TYPES = new Set([
  "manual_scan",
  "mcp_review",
  "webhook_push_scan",
  "webhook_pr_scan",
  "automatic_review",
]);

const TERMINAL_SCAN_STATUSES = new Set(["completed", "failed", "cancelled"]);

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "reconcile-orphan-scan-job", event, ...fields });
}

/**
 * When a scan reached a terminal status but its job is still queued/running
 * (worker died after persisting the scan), reconcile the job so new reviews
 * are not blocked and recovery cron is not required.
 */
export async function reconcileOrphanScanJobWithTerminalScan(
  admin: SupabaseClient,
  input: {
    jobId: string;
    scan: Record<string, unknown>;
  }
): Promise<boolean> {
  const scanStatus = String(input.scan.status ?? "").toLowerCase();
  if (!TERMINAL_SCAN_STATUSES.has(scanStatus)) return false;

  const job = await getScanJob(admin, input.jobId);
  if (!job || isTerminalScanJobStatus(job.status)) return false;
  if (job.status !== "queued" && job.status !== "running") return false;

  log("orphan_detected", {
    scanJobId: job.id,
    scanId: input.scan.id,
    scanStatus,
    jobStatus: job.status,
    jobType: job.job_type,
  });

  if (scanStatus === "failed") {
    const transitioned = await markScanJobFailed(admin, job.id, {
      failureCode: (input.scan.error_code as string | null) ?? "SCAN_ALREADY_FAILED",
      failureMessage:
        (input.scan.error_message as string | null) ??
        "Scan failed before the worker finalized the job",
    });
    return transitioned.updated;
  }

  if (scanStatus === "cancelled") {
    const transitioned = await markScanJobCancelled(admin, job.id, {
      failureCode: "USER_CANCELLED",
      failureMessage: "Review cancelled before the worker finalized the job",
    });
    return transitioned.updated;
  }

  if (scanStatus !== "completed") return false;

  const finalize = job.metadata?.finalize as ScanRunPayload["finalize"];
  const finalizeCompleted = job.metadata?.finalizeCompleted === true;
  const needsFinalize = Boolean(finalize) && !finalizeCompleted;

  if (needsFinalize && SCAN_RUN_JOB_TYPES.has(job.job_type)) {
    try {
      const payload = buildScanRunPayloadFromRow({ scan: input.scan, job });
      await executeScanRunJob(admin, { ...payload, finalize });
      log("orphan_finalize_recovered", { scanJobId: job.id, scanId: input.scan.id });
      return true;
    } catch (error) {
      log("orphan_finalize_failed", {
        scanJobId: job.id,
        scanId: input.scan.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const transitioned = await markScanJobCompleted(admin, job.id);
  if (transitioned.updated) {
    log("orphan_marked_completed", { scanJobId: job.id, scanId: input.scan.id });
    if (job.job_type !== "automatic_review" && job.metadata?.persistMode !== "review_only") {
      await ensureProductionVerdictForCompletedScan(admin, {
        organizationId: job.organization_id,
        projectId: job.project_id ?? (input.scan.repository_id as string),
        scanId: input.scan.id as string,
        scanJobId: job.id,
      }).catch(() => undefined);
    }
  }
  return transitioned.updated;
}

export async function reconcileProjectOrphanScanJobs(
  admin: SupabaseClient,
  projectId: string
): Promise<number> {
  const { data: jobs } = await admin
    .from("scan_jobs")
    .select("id, scan_id, status")
    .eq("project_id", projectId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(5);

  let reconciled = 0;
  for (const job of jobs ?? []) {
    if (!job.scan_id) continue;
    const { data: scan } = await admin.from("scans").select("*").eq("id", job.scan_id).maybeSingle();
    if (!scan) continue;
    const ok = await reconcileOrphanScanJobWithTerminalScan(admin, {
      jobId: job.id as string,
      scan: scan as Record<string, unknown>,
    });
    if (ok) reconciled += 1;
  }
  return reconciled;
}
