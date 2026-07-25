import { describe, expect, it } from "vitest";
import { evaluateOperationalAlerts } from "../alert-routing";
import type { JobsHealthSummary } from "../health-summary";

const baseSummary: JobsHealthSummary = {
  schedulerMode: "inngest",
  queuedJobs: 0,
  runningJobs: 0,
  failedJobsLast24h: 0,
  retriesLast24h: 0,
  stuckJobs: 0,
  oldestQueuedJobAgeMs: null,
  activeJobsByOrganization: {},
  durationMs: { p50: null, p95: null, p99: null, count: 0 },
  queueWaitMs: { p50: null, p95: null, p99: null, count: 0 },
  recentWebhookFailures: 0,
  inProcessMetricCounters: {
    jobs_created_total: 100,
    jobs_completed_total: 95,
    jobs_failed_total: 0,
    jobs_retried_total: 0,
    jobs_timed_out_total: 0,
    jobs_recovered_total: 0,
    duplicate_webhooks_total: 0,
    duplicate_scans_prevented_total: 0,
    notification_failures_total: 0,
    stuck_jobs_total: 0,
  },
  generatedAt: new Date().toISOString(),
};

describe("evaluateOperationalAlerts", () => {
  it("flags stuck jobs", () => {
    const result = evaluateOperationalAlerts({ ...baseSummary, stuckJobs: 2 });
    expect(result.alerts.some((a) => a.id === "stuck_jobs")).toBe(true);
    expect(result.healthy).toBe(false);
  });

  it("flags high queue wait p95", () => {
    const result = evaluateOperationalAlerts({
      ...baseSummary,
      queueWaitMs: { p50: 1000, p95: 130_000, p99: 150_000, count: 10 },
    });
    expect(result.alerts.some((a) => a.id === "queue_wait_p95_high")).toBe(true);
  });

  it("flags failure rate above 1%", () => {
    const result = evaluateOperationalAlerts(
      { ...baseSummary, failedJobsLast24h: 5 },
      { jobsCreatedLast24h: 100 }
    );
    expect(result.alerts.some((a) => a.id === "permanent_failure_rate_high")).toBe(true);
  });

  it("returns healthy when all thresholds pass", () => {
    const result = evaluateOperationalAlerts(baseSummary, { jobsCreatedLast24h: 100 });
    expect(result.healthy).toBe(true);
    expect(result.alerts).toHaveLength(0);
  });
});
