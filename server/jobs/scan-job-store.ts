import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { emitOperationalEvent } from "@/server/observability/operational-events";
import { incrementMetricCounter } from "@/server/observability/metrics";
import {
  DEFAULT_JOB_TIMEOUT_MS,
  getQueueStaleMinutes,
  getRecoveryMaxAttempts,
} from "@/server/observability/types";
import type { ScanJobStatus, ScanJobType } from "./types";
import {
  ALLOWED_SOURCE_STATUSES,
  canRecoverScanJobToQueued,
  isTerminalScanJobStatus,
} from "./job-transitions";

export type ScanJobRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  scan_id: string | null;
  github_delivery_id: string | null;
  job_type: ScanJobType;
  status: ScanJobStatus;
  failure_code: string | null;
  failure_message: string | null;
  inngest_run_id: string | null;
  attempt_count: number;
  max_attempts: number;
  metadata: Record<string, unknown>;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  heartbeat_at: string | null;
  execution_deadline_at: string | null;
  last_recovery_at: string | null;
  recovery_attempts: number;
  max_recovery_attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  queue_wait_ms: number | null;
  duration_ms: number | null;
};

async function transitionScanJob(
  admin: SupabaseClient,
  jobId: string,
  to: ScanJobStatus,
  values: Record<string, unknown>,
  allowedFrom: readonly ScanJobStatus[]
): Promise<{ updated: boolean; job?: ScanJobRow | null }> {
  const { data, error } = await admin
    .from("scan_jobs")
    .update({
      status: to,
      updated_at: new Date().toISOString(),
      ...values,
    })
    .eq("id", jobId)
    .in("status", [...allowedFrom])
    .select("*")
    .maybeSingle();

  if (error) throw new Error(`Could not transition scan job to ${to}: ${error.message}`);
  return { updated: Boolean(data), job: (data as ScanJobRow | null) ?? null };
}

function baseEventFields(job: ScanJobRow | null | undefined, overrides?: Record<string, unknown>) {
  return {
    scanJobId: job?.id,
    organizationId: job?.organization_id,
    projectId: job?.project_id,
    scanId: job?.scan_id,
    jobType: job?.job_type,
    ...overrides,
  };
}

export async function createScanJob(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId?: string | null;
    scanId?: string | null;
    githubDeliveryId?: string | null;
    jobType: ScanJobType;
    metadata?: Record<string, unknown>;
    maxAttempts?: number;
  }
): Promise<{ job: ScanJobRow | null; duplicate: boolean }> {
  const executionDeadline = new Date(Date.now() + DEFAULT_JOB_TIMEOUT_MS).toISOString();
  const { data, error } = await admin
    .from("scan_jobs")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId ?? null,
      scan_id: input.scanId ?? null,
      github_delivery_id: input.githubDeliveryId ?? null,
      job_type: input.jobType,
      status: "queued",
      metadata: input.metadata ?? {},
      max_attempts: input.maxAttempts ?? 3,
      max_recovery_attempts: getRecoveryMaxAttempts(),
      execution_deadline_at: executionDeadline,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      await emitOperationalEvent(admin, {
        eventType: "duplicate_scan_prevented",
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        scanId: input.scanId ?? null,
        jobType: input.jobType,
        metadata: {
          deliveryId: input.githubDeliveryId ?? null,
        },
      });
      return { job: null, duplicate: true };
    }
    throw new Error(`Could not create scan job: ${error.message}`);
  }

  const job = data as ScanJobRow;
  await emitOperationalEvent(admin, {
    eventType: "job_created",
    ...baseEventFields(job),
  });
  await emitOperationalEvent(admin, {
    eventType: "job_queued",
    ...baseEventFields(job),
  });

  return { job, duplicate: false };
}

export async function getScanJob(
  admin: SupabaseClient,
  jobId: string
): Promise<ScanJobRow | null> {
  const { data, error } = await admin.from("scan_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`Could not load scan job: ${error.message}`);
  return (data as ScanJobRow | null) ?? null;
}

export async function claimScanJob(
  admin: SupabaseClient,
  jobId: string,
  input: { lockedBy: string; inngestRunId?: string; attemptCount?: number }
): Promise<{ claimed: boolean; job: ScanJobRow | null }> {
  const now = new Date();
  const nowIso = now.toISOString();
  const existing = await getScanJob(admin, jobId);
  if (!existing) return { claimed: false, job: null };
  if (isTerminalScanJobStatus(existing.status)) {
    return { claimed: false, job: existing };
  }

  const scheduledAt = new Date(existing.scheduled_at).getTime();
  const queueWaitMs = Number.isFinite(scheduledAt) ? Math.max(0, now.getTime() - scheduledAt) : null;

  const { updated, job } = await transitionScanJob(
    admin,
    jobId,
    "running",
    {
      started_at: existing.started_at ?? nowIso,
      locked_at: nowIso,
      locked_by: input.lockedBy,
      heartbeat_at: nowIso,
      execution_deadline_at: new Date(now.getTime() + DEFAULT_JOB_TIMEOUT_MS).toISOString(),
      queue_wait_ms: queueWaitMs,
      ...(input.inngestRunId ? { inngest_run_id: input.inngestRunId } : {}),
      ...(input.attemptCount != null ? { attempt_count: input.attemptCount } : {}),
    },
    ALLOWED_SOURCE_STATUSES.running
  );

  if (!updated || !job) return { claimed: false, job: existing };

  const eventType =
    input.attemptCount != null && input.attemptCount > 1 ? "job_retried" : "job_started";
  await emitOperationalEvent(admin, {
    eventType,
    ...baseEventFields(job, {
      attempt: input.attemptCount ?? job.attempt_count,
      queueWaitMs,
    }),
  });

  return { claimed: true, job };
}

export async function markScanJobRunning(
  admin: SupabaseClient,
  jobId: string,
  input?: { inngestRunId?: string; attemptCount?: number; lockedBy?: string }
): Promise<{ updated: boolean }> {
  const result = await claimScanJob(admin, jobId, {
    lockedBy: input?.lockedBy ?? "scan-worker",
    inngestRunId: input?.inngestRunId,
    attemptCount: input?.attemptCount,
  });
  return { updated: result.claimed };
}

export async function touchScanJobHeartbeat(
  admin: SupabaseClient,
  jobId: string
): Promise<void> {
  await admin
    .from("scan_jobs")
    .update({
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "running");
}

export async function markScanJobCompleted(
  admin: SupabaseClient,
  jobId: string
): Promise<{ updated: boolean }> {
  const existing = await getScanJob(admin, jobId);
  if (existing?.scan_id) {
    const { data: scan } = await admin
      .from("scans")
      .select("status")
      .eq("id", existing.scan_id)
      .maybeSingle();
    if (scan?.status === "failed") {
      return { updated: false };
    }
  }

  const startedAt = existing?.started_at ? new Date(existing.started_at).getTime() : null;
  const durationMs =
    startedAt && Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : null;

  const { updated, job } = await transitionScanJob(
    admin,
    jobId,
    "completed",
    {
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      locked_at: null,
      locked_by: null,
    },
    ALLOWED_SOURCE_STATUSES.completed
  );

  if (updated && job) {
    await emitOperationalEvent(admin, {
      eventType: "job_completed",
      ...baseEventFields(job, { durationMs }),
    });
  }
  return { updated };
}

export async function markScanJobFailed(
  admin: SupabaseClient,
  jobId: string,
  input: { failureCode: string; failureMessage: string; eventType?: "job_failed" | "job_timed_out" }
): Promise<{ updated: boolean }> {
  const eventType = input.eventType ?? "job_failed";
  const { updated, job } = await transitionScanJob(
    admin,
    jobId,
    "failed",
    {
      failure_code: input.failureCode,
      failure_message: input.failureMessage,
      failed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    },
    ALLOWED_SOURCE_STATUSES.failed
  );

  if (updated && job) {
    await emitOperationalEvent(admin, {
      eventType,
      ...baseEventFields(job, { failureCode: input.failureCode }),
    });
    const { syncScanFailureFromJob } = await import("./scan-execution/review-lifecycle");
    await syncScanFailureFromJob(admin, jobId, {
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
    }).catch((error) => {
      console.error({
        component: "scan-job-store",
        event: "sync_scan_failure_failed",
        scanJobId: jobId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return { updated };
}

export async function markScanJobCancelled(
  admin: SupabaseClient,
  jobId: string,
  input?: { failureCode?: string; failureMessage?: string }
): Promise<{ updated: boolean }> {
  const { updated, job } = await transitionScanJob(
    admin,
    jobId,
    "cancelled",
    {
      failure_code: input?.failureCode ?? "JOB_CANCELLED",
      failure_message: input?.failureMessage ?? "Job cancelled",
      cancelled_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    },
    ALLOWED_SOURCE_STATUSES.cancelled
  );

  if (updated && job) {
    await emitOperationalEvent(admin, {
      eventType: "job_cancelled",
      ...baseEventFields(job, { failureCode: input?.failureCode ?? "JOB_CANCELLED" }),
    });
  }
  return { updated };
}

export async function recoverScanJobToQueued(
  admin: SupabaseClient,
  job: ScanJobRow,
  input: { lockedBy: string }
): Promise<{ recovered: boolean; job: ScanJobRow | null }> {
  if (!canRecoverScanJobToQueued(job.status)) {
    await emitOperationalEvent(admin, {
      eventType: "invalid_transition",
      ...baseEventFields(job, { metadata: { attempted: `${job.status} → queued` } }),
    });
    return { recovered: false, job };
  }

  if (job.recovery_attempts >= job.max_recovery_attempts) {
    await markScanJobFailed(admin, job.id, {
      failureCode: "RECOVERY_EXHAUSTED",
      failureMessage: "Maximum recovery attempts reached",
    });
    await emitOperationalEvent(admin, {
      eventType: "recovery_exhausted",
      ...baseEventFields(job),
    });
    return { recovered: false, job: await getScanJob(admin, job.id) };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("scan_jobs")
    .update({
      status: "queued",
      updated_at: nowIso,
      last_recovery_at: nowIso,
      recovery_attempts: job.recovery_attempts + 1,
      locked_at: null,
      locked_by: null,
      heartbeat_at: null,
      execution_deadline_at: new Date(Date.now() + DEFAULT_JOB_TIMEOUT_MS).toISOString(),
    })
    .eq("id", job.id)
    .in("status", ["queued", "running"])
    .select("*")
    .maybeSingle();

  if (error) throw new Error(`Could not recover scan job: ${error.message}`);
  if (!data) return { recovered: false, job };

  const recoveredJob = data as ScanJobRow;
  await emitOperationalEvent(admin, {
    eventType: "job_recovered",
    ...baseEventFields(recoveredJob, {
      attempt: recoveredJob.recovery_attempts,
      metadata: { lockedBy: input.lockedBy },
    }),
  });
  incrementMetricCounter("jobs_recovered_total");
  return { recovered: true, job: recoveredJob };
}

export async function findActiveScanJobByScanId(
  admin: SupabaseClient,
  scanId: string
): Promise<ScanJobRow | null> {
  const { data, error } = await admin
    .from("scan_jobs")
    .select("*")
    .eq("scan_id", scanId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load active scan job: ${error.message}`);
  return (data as ScanJobRow | null) ?? null;
}

export async function findLatestScanJobByScanId(
  admin: SupabaseClient,
  scanId: string
): Promise<ScanJobRow | null> {
  const { data, error } = await admin
    .from("scan_jobs")
    .select("*")
    .eq("scan_id", scanId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load scan job: ${error.message}`);
  return (data as ScanJobRow | null) ?? null;
}

export async function findWebhookIngressJob(
  admin: SupabaseClient,
  organizationId: string,
  deliveryId: string
): Promise<ScanJobRow | null> {
  const { data, error } = await admin
    .from("scan_jobs")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("github_delivery_id", deliveryId)
    .eq("job_type", "webhook_process")
    .maybeSingle();

  if (error) throw new Error(`Could not load webhook ingress job: ${error.message}`);
  return (data as ScanJobRow | null) ?? null;
}

function dedupeScanJobsById(jobs: ScanJobRow[]): ScanJobRow[] {
  const seen = new Set<string>();
  const deduped: ScanJobRow[] = [];
  for (const job of jobs) {
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    deduped.push(job);
  }
  return deduped;
}

export async function findStuckScanJobs(admin: SupabaseClient): Promise<ScanJobRow[]> {
  const queueStaleBefore = new Date(
    Date.now() - getQueueStaleMinutes() * 60 * 1000
  ).toISOString();
  const nowIso = new Date().toISOString();
  const { getScanJobHeartbeatStaleMs } = await import("./scan-job-heartbeat");
  const heartbeatStaleBefore = new Date(Date.now() - getScanJobHeartbeatStaleMs()).toISOString();

  const [{ data: staleQueued }, { data: staleRunningDeadline }, { data: staleRunningHeartbeat }] =
    await Promise.all([
    admin
      .from("scan_jobs")
      .select("*")
      .eq("status", "queued")
      .lt("scheduled_at", queueStaleBefore)
      .order("scheduled_at", { ascending: true })
      .limit(100),
    admin
      .from("scan_jobs")
      .select("*")
      .eq("status", "running")
      .lt("execution_deadline_at", nowIso)
      .order("execution_deadline_at", { ascending: true })
      .limit(100),
    admin
      .from("scan_jobs")
      .select("*")
      .eq("status", "running")
      .not("heartbeat_at", "is", null)
      .lt("heartbeat_at", heartbeatStaleBefore)
      .order("heartbeat_at", { ascending: true })
      .limit(100),
  ]);

  const merged = dedupeScanJobsById([
    ...((staleQueued as ScanJobRow[]) ?? []),
    ...((staleRunningDeadline as ScanJobRow[]) ?? []),
    ...((staleRunningHeartbeat as ScanJobRow[]) ?? []),
  ]);
  incrementMetricCounter("stuck_jobs_total", merged.length);
  return merged;
}

export async function findJobsNeedingFinalize(admin: SupabaseClient): Promise<ScanJobRow[]> {
  const { data: runningJobs, error } = await admin
    .from("scan_jobs")
    .select("*")
    .eq("status", "running")
    .not("scan_id", "is", null)
    .limit(100);

  if (error) throw new Error(`Could not load running jobs for finalize recovery: ${error.message}`);

  const results: ScanJobRow[] = [];
  for (const job of (runningJobs as ScanJobRow[]) ?? []) {
    if (job.metadata?.finalizeCompleted === true) continue;
    if (!job.scan_id) continue;
    const { data: scan } = await admin.from("scans").select("status").eq("id", job.scan_id).maybeSingle();
    if (scan?.status === "completed") results.push(job);
  }
  return results;
}

export async function cancelStuckScanJobs(admin: SupabaseClient): Promise<number> {
  const stuck = await findStuckScanJobs(admin);
  let failed = 0;
  for (const job of stuck) {
    const result = await markScanJobFailed(admin, job.id, {
      failureCode: "SCAN_JOB_TIMEOUT",
      failureMessage: "Scan job exceeded its execution lease",
      eventType: "job_timed_out",
    });
    if (result.updated) failed += 1;
  }
  return failed;
}
