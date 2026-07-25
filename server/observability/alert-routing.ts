import "server-only";

import type { JobsHealthSummary } from "./health-summary";

export type AlertSeverity = "warning" | "critical";

export type OperationalAlert = {
  id: string;
  severity: AlertSeverity;
  message: string;
  value?: number | string | null;
  threshold?: number | string;
};

export type AlertEvaluation = {
  alerts: OperationalAlert[];
  healthy: boolean;
  evaluatedAt: string;
};

const QUEUE_WAIT_P95_MS = 2 * 60 * 1000;
const PERMANENT_FAILURE_RATE = 0.01;
const TIMEOUT_RATE = 0.01;

export function evaluateOperationalAlerts(
  summary: JobsHealthSummary,
  input?: {
    failedJobsLast15m?: number;
    timeoutEventsLast24h?: number;
    duplicateSideEffectsLast24h?: number;
    recoveryExhaustedLast24h?: number;
    inngestSigningFailuresLast15m?: number;
    jobsCreatedLast24h?: number;
  }
): AlertEvaluation {
  const alerts: OperationalAlert[] = [];
  const counters = summary.inProcessMetricCounters;
  const jobsCreated = Math.max(
    input?.jobsCreatedLast24h ?? 0,
    counters.jobs_created_total,
    summary.failedJobsLast24h + (summary.durationMs.count ?? 0)
  );

  if (summary.stuckJobs > 0) {
    alerts.push({
      id: "stuck_jobs",
      severity: "critical",
      message: "Stuck scan jobs detected",
      value: summary.stuckJobs,
      threshold: 0,
    });
  }

  if (summary.queueWaitMs.p95 != null && summary.queueWaitMs.p95 > QUEUE_WAIT_P95_MS) {
    alerts.push({
      id: "queue_wait_p95_high",
      severity: "warning",
      message: "Queue wait p95 exceeds 2 minutes",
      value: summary.queueWaitMs.p95,
      threshold: QUEUE_WAIT_P95_MS,
    });
  }

  if (jobsCreated > 0) {
    const failureRate = summary.failedJobsLast24h / jobsCreated;
    if (failureRate > PERMANENT_FAILURE_RATE) {
      alerts.push({
        id: "permanent_failure_rate_high",
        severity: "critical",
        message: "Permanent failure rate exceeds 1%",
        value: Number((failureRate * 100).toFixed(2)),
        threshold: PERMANENT_FAILURE_RATE * 100,
      });
    }

    const timeoutRate = (input?.timeoutEventsLast24h ?? counters.jobs_timed_out_total) / jobsCreated;
    if (timeoutRate > TIMEOUT_RATE) {
      alerts.push({
        id: "timeout_rate_high",
        severity: "critical",
        message: "Timeout rate exceeds 1%",
        value: Number((timeoutRate * 100).toFixed(2)),
        threshold: TIMEOUT_RATE * 100,
      });
    }
  }

  if ((input?.failedJobsLast15m ?? 0) > 10) {
    alerts.push({
      id: "failed_jobs_spike",
      severity: "critical",
      message: "More than 10 failed jobs in 15 minutes",
      value: input?.failedJobsLast15m,
      threshold: 10,
    });
  }

  if ((input?.recoveryExhaustedLast24h ?? 0) > 0) {
    alerts.push({
      id: "recovery_exhausted",
      severity: "critical",
      message: "Recovery attempts exhausted for one or more jobs",
      value: input?.recoveryExhaustedLast24h,
      threshold: 0,
    });
  }

  if ((input?.duplicateSideEffectsLast24h ?? 0) > 0) {
    alerts.push({
      id: "duplicate_side_effects",
      severity: "critical",
      message: "Duplicate side effects detected",
      value: input?.duplicateSideEffectsLast24h,
      threshold: 0,
    });
  }

  if ((input?.inngestSigningFailuresLast15m ?? 0) > 5) {
    alerts.push({
      id: "inngest_signing_failures_spike",
      severity: "warning",
      message: "Inngest signing verification failures spiking",
      value: input?.inngestSigningFailuresLast15m,
      threshold: 5,
    });
  }

  return {
    alerts,
    healthy: alerts.length === 0,
    evaluatedAt: new Date().toISOString(),
  };
}

export async function emitOperationalAlerts(alerts: OperationalAlert[]): Promise<void> {
  if (!alerts.length) return;

  for (const alert of alerts) {
    console.error({
      component: "ops-alerts",
      alertId: alert.id,
      severity: alert.severity,
      message: alert.message,
      value: alert.value ?? null,
      threshold: alert.threshold ?? null,
      timestamp: new Date().toISOString(),
    });
  }

  const webhookUrl = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: alerts.map((a) => `[${a.severity.toUpperCase()}] ${a.id}: ${a.message}`).join("\n"),
        alerts,
      }),
    });
  } catch (error) {
    console.error({
      component: "ops-alerts",
      event: "webhook_delivery_failed",
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function fetchAlertWindowMetrics(
  admin: import("@supabase/supabase-js").SupabaseClient
): Promise<{
  failedJobsLast15m: number;
  timeoutEventsLast24h: number;
  duplicateSideEffectsLast24h: number;
  recoveryExhaustedLast24h: number;
  jobsCreatedLast24h: number;
}> {
  const now = Date.now();
  const last15m = new Date(now - 15 * 60 * 1000).toISOString();
  const last24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const [failed15m, timeouts, recoveryExhausted, created, duplicateSideEffects] = await Promise.all([
    admin
      .from("scan_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("failed_at", last15m),
    admin
      .from("scan_job_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "job_timed_out")
      .gte("created_at", last24h),
    admin
      .from("scan_job_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "recovery_exhausted")
      .gte("created_at", last24h),
    admin
      .from("scan_job_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "job_created")
      .gte("created_at", last24h),
    admin
      .from("scan_job_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "duplicate_scan_prevented")
      .gte("created_at", last24h),
  ]);

  return {
    failedJobsLast15m: failed15m.count ?? 0,
    timeoutEventsLast24h: timeouts.count ?? 0,
    recoveryExhaustedLast24h: recoveryExhausted.count ?? 0,
    jobsCreatedLast24h: created.count ?? 0,
    duplicateSideEffectsLast24h: duplicateSideEffects.count ?? 0,
  };
}
