import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeScanRunJob } from "./run-scan-job";
import type { ScanRunPayload } from "./types";
import { getScanJob } from "./scan-job-store";
import { beginReviewProcessing, failReviewExecution } from "./scan-execution/review-lifecycle";
import { expireStaleActiveReviewsForRepository } from "@/server/review-recovery/stale-review";

const KICK_AFTER_MS = 12_000;
const FAIL_IF_NEVER_STARTED_MS = 4 * 60 * 1000;

export function buildScanRunPayloadFromRow(input: {
  scan: Record<string, unknown>;
  job: { id: string; job_type?: string | null; organization_id?: string | null; project_id?: string | null; metadata?: unknown };
}): ScanRunPayload {
  const meta = (input.job.metadata as Record<string, unknown> | null) ?? {};
  return {
    scanJobId: input.job.id,
    scanId: input.scan.id as string,
    organizationId:
      (input.scan.organization_id as string) ??
      (input.job.organization_id as string),
    projectId:
      (input.scan.project_id as string) ??
      (input.job.project_id as string) ??
      (input.scan.repository_id as string),
    userId: (input.scan.triggered_by_user_id as string) ?? "recovery-kick",
    jobType: (input.job.job_type as ScanRunPayload["jobType"]) ?? "manual_scan",
    scanType: (meta.scanType as "full" | "incremental") ?? "full",
    branch: (meta.branch as string | undefined) ?? (input.scan.branch as string | undefined),
    headCommitSha:
      (meta.headCommitSha as string | undefined) ??
      (input.scan.commit_sha as string | undefined),
  };
}

function scanAgeMs(scan: Record<string, unknown>, job: { created_at?: string | null } | null): number {
  const anchor =
    (job?.created_at as string | null) ??
    (scan.created_at as string | null) ??
    (scan.queued_at as string | null);
  if (!anchor) return 0;
  return Date.now() - new Date(anchor).getTime();
}

/**
 * Schedules inline scan execution for reviews stuck before the worker advances scan status.
 */
export function scheduleStuckProductionReviewExecution(
  admin: SupabaseClient,
  input: {
    scan: Record<string, unknown>;
    scanJob: { id: string; status: string; created_at?: string | null } | null;
  }
): { scheduled: boolean; reason: string } {
  const scanStatus = String(input.scan.status ?? "").toLowerCase();
  if (!["queued", "fetching_repository"].includes(scanStatus)) {
    return { scheduled: false, reason: "scan_not_waiting" };
  }
  if (!input.scanJob) {
    return { scheduled: false, reason: "no_scan_job" };
  }

  const age = scanAgeMs(input.scan, input.scanJob);
  if (age < KICK_AFTER_MS) {
    return { scheduled: false, reason: "too_young" };
  }

  const jobStatus = input.scanJob.status;
  const orphanRunning = scanStatus === "queued" && jobStatus === "running";
  const neverStarted = jobStatus === "queued";
  if (!neverStarted && !orphanRunning) {
    return { scheduled: false, reason: "job_not_kickable" };
  }

  const scanId = input.scan.id as string;
  const projectId =
    (input.scan.repository_id as string) ??
    (input.scan.project_id as string);

  after(async () => {
    try {
      const job = await getScanJob(admin, input.scanJob!.id);
      if (!job) return;

      if (scanStatus === "queued") {
        await beginReviewProcessing(admin, {
          reviewId: scanId,
          scanJobId: job.id,
          organizationId: job.organization_id,
          projectId,
          commitSha: (input.scan.commit_sha as string | null) ?? null,
          scheduler: "stuck-scan-kick",
        }).catch(() => undefined);
      }

      const payload = buildScanRunPayloadFromRow({ scan: input.scan, job });
      await executeScanRunJob(admin, payload, { lockedBy: "stuck-scan-kick" });
    } catch (error) {
      console.error({
        component: "kick-stuck-scan-run",
        event: "scheduled_execution_failed",
        scanId,
        scanJobId: input.scanJob!.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  console.info({
    component: "kick-stuck-scan-run",
    event: "execution_scheduled",
    scanId,
    scanJobId: input.scanJob.id,
    scanStatus,
    jobStatus,
    ageMs: age,
  });

  return { scheduled: true, reason: orphanRunning ? "orphan_running_job" : "queued_job" };
}

export async function maybeFailNeverStartedProductionReview(
  admin: SupabaseClient,
  input: {
    scan: Record<string, unknown>;
    scanJob: { id: string; status: string; created_at?: string | null; started_at?: string | null } | null;
  }
): Promise<boolean> {
  const scanStatus = String(input.scan.status ?? "").toLowerCase();
  if (scanStatus !== "queued") return false;
  if (!input.scanJob) return false;

  const age = scanAgeMs(input.scan, input.scanJob);
  if (age < FAIL_IF_NEVER_STARTED_MS) return false;

  const trace = await getScanJob(admin, input.scanJob.id);
  const metadata = (trace?.metadata as Record<string, unknown> | null) ?? {};
  const executionTrace = (metadata.executionTrace as { stages?: Array<{ stage: string }> } | undefined)
    ?.stages;
  const workerStarted =
    Boolean(trace?.started_at) ||
    Boolean(executionTrace?.some((s) => s.stage === "worker_started" || s.stage === "scan_started"));

  if (workerStarted && input.scanJob.status === "running") {
    return false;
  }

  if (input.scanJob.status !== "queued" && !(scanStatus === "queued" && input.scanJob.status === "running")) {
    return false;
  }

  await failReviewExecution(admin, {
    reviewId: input.scan.id as string,
    projectId:
      (input.scan.repository_id as string) ??
      (input.scan.project_id as string),
    organizationId: input.scan.organization_id as string,
    scanJobId: input.scanJob.id,
    commitSha: (input.scan.commit_sha as string | null) ?? null,
    failureCode: "WORKER_NEVER_STARTED",
    failureMessage:
      "Production Review worker did not start. Retry the review after the latest deploy.",
    stage: "enqueue_failed",
    scheduler: "inline",
  });

  return true;
}

export async function recoverStuckProductionReviewOnPoll(
  admin: SupabaseClient,
  input: {
    scan: Record<string, unknown>;
    scanJob: { id: string; status: string; created_at?: string | null; started_at?: string | null } | null;
  }
): Promise<void> {
  const projectId =
    (input.scan.repository_id as string) ??
    (input.scan.project_id as string);
  if (projectId) {
    await expireStaleActiveReviewsForRepository(admin, projectId).catch(() => undefined);
  }

  const failed = await maybeFailNeverStartedProductionReview(admin, input);
  if (failed) return;

  scheduleStuckProductionReviewExecution(admin, input);
}

// Backwards-compatible export used during migration
export async function maybeKickStuckQueuedScanRun(
  admin: SupabaseClient,
  input: {
    scan: Record<string, unknown>;
    scanJob: { id: string; status: string; created_at?: string | null } | null;
  }
): Promise<boolean> {
  const result = scheduleStuckProductionReviewExecution(admin, input);
  return result.scheduled;
}
