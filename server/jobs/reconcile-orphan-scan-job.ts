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
import { assessScanJobAbandonment } from "./orphan-policy";
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

  // "Scan completed + job still running" is how a HEALTHY job looks while its platform stage and engines run. Only a
  // verifiable absence of activity makes it an orphan (see orphan-policy.ts). A failed/cancelled scan is terminal either way.
  if (scanStatus === "completed") {
    const assessment = assessScanJobAbandonment(job as never);
    if (!assessment.abandoned) {
      log("orphan_candidate_still_active", {
        scanJobId: job.id,
        scanId: input.scan.id,
        jobStatus: job.status,
        lastActivityAt: assessment.lastActivityAt,
      });
      return false;
    }
  }

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

  const needsVerdict = job.job_type !== "automatic_review" && job.metadata?.persistMode !== "review_only";
  if (needsVerdict) {
    // The runner that would have finalized this scan is gone. Generate from the evidence that exists -- but only once every
    // engine job is terminal (engines that outlived their own timeout are terminalized explicitly: TIMED_OUT / REJECTED, never
    // success). While live engines are still within their budget the job is left as it is and the next pass decides.
    const outcome = await ensureProductionVerdictForCompletedScan(admin, {
      organizationId: job.organization_id,
      projectId: job.project_id ?? (input.scan.repository_id as string),
      scanId: input.scan.id as string,
      scanJobId: job.id,
      mode: "recovery",
    }).catch((error) => {
      log("orphan_verdict_recovery_failed", {
        scanJobId: job.id,
        scanId: input.scan.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    if (!outcome || outcome.deferred) {
      log("orphan_waiting_for_engines", { scanJobId: job.id, scanId: input.scan.id, deferred: Boolean(outcome?.deferred) });
      return false;
    }
  }

  const transitioned = await markScanJobCompleted(admin, job.id);
  if (transitioned.updated) {
    log("orphan_marked_completed", { scanJobId: job.id, scanId: input.scan.id });
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
