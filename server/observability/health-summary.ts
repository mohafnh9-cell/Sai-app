import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getScanSchedulerMode } from "@/lib/env/scan-scheduler";
import { getMetricCounters, percentileSummary } from "./metrics";
import { getQueueStaleMinutes } from "./types";

export type JobsHealthSummary = {
  schedulerMode: string;
  queuedJobs: number;
  runningJobs: number;
  failedJobsLast24h: number;
  retriesLast24h: number;
  stuckJobs: number;
  oldestQueuedJobAgeMs: number | null;
  activeJobsByOrganization: Record<string, number>;
  durationMs: { p50: number | null; p95: number | null; p99: number | null; count: number };
  queueWaitMs: { p50: number | null; p95: number | null; p99: number | null; count: number };
  recentWebhookFailures: number;
  inProcessMetricCounters: ReturnType<typeof getMetricCounters>;
  generatedAt: string;
};

export async function buildJobsHealthSummary(admin: SupabaseClient): Promise<JobsHealthSummary> {
  const now = Date.now();
  const last24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const staleBefore = new Date(now - getQueueStaleMinutes() * 60 * 1000).toISOString();

  const [
    queuedRes,
    runningRes,
    failedRes,
    retryRes,
    stuckRes,
    oldestQueuedRes,
    runningByOrgRes,
    durationEventsRes,
    queueEventsRes,
    webhookFailuresRes,
  ] = await Promise.all([
    admin.from("scan_jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    admin.from("scan_jobs").select("id", { count: "exact", head: true }).eq("status", "running"),
    admin
      .from("scan_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("failed_at", last24h),
    admin
      .from("scan_job_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "job_retried")
      .gte("created_at", last24h),
    admin
      .from("scan_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "running"])
      .lt("updated_at", staleBefore),
    admin
      .from("scan_jobs")
      .select("scheduled_at")
      .eq("status", "queued")
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin.from("scan_jobs").select("organization_id").eq("status", "running"),
    admin
      .from("scan_job_events")
      .select("duration_ms")
      .eq("event_type", "job_completed")
      .gte("created_at", last24h)
      .not("duration_ms", "is", null)
      .limit(5000),
    admin
      .from("scan_job_events")
      .select("queue_wait_ms")
      .eq("event_type", "job_started")
      .gte("created_at", last24h)
      .not("queue_wait_ms", "is", null)
      .limit(5000),
    admin
      .from("scan_job_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "job_failed")
      .eq("job_type", "webhook_process")
      .gte("created_at", last24h),
  ]);

  const activeJobsByOrganization: Record<string, number> = {};
  for (const row of runningByOrgRes.data ?? []) {
    const orgId = row.organization_id as string;
    activeJobsByOrganization[orgId] = (activeJobsByOrganization[orgId] ?? 0) + 1;
  }

  const oldestQueuedAt = oldestQueuedRes.data?.scheduled_at as string | undefined;
  const oldestQueuedJobAgeMs = oldestQueuedAt ? now - new Date(oldestQueuedAt).getTime() : null;

  const durationValues = (durationEventsRes.data ?? [])
    .map((row) => row.duration_ms as number)
    .filter((value) => Number.isFinite(value));
  const queueValues = (queueEventsRes.data ?? [])
    .map((row) => row.queue_wait_ms as number)
    .filter((value) => Number.isFinite(value));

  return {
    schedulerMode: getScanSchedulerMode(),
    queuedJobs: queuedRes.count ?? 0,
    runningJobs: runningRes.count ?? 0,
    failedJobsLast24h: failedRes.count ?? 0,
    retriesLast24h: retryRes.count ?? 0,
    stuckJobs: stuckRes.count ?? 0,
    oldestQueuedJobAgeMs,
    activeJobsByOrganization,
    durationMs: percentileSummary(durationValues),
    queueWaitMs: percentileSummary(queueValues),
    recentWebhookFailures: webhookFailuresRes.count ?? 0,
    inProcessMetricCounters: getMetricCounters(),
    generatedAt: new Date().toISOString(),
  };
}
