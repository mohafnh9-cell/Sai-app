import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/scan-scheduler", () => ({
  getScanSchedulerMode: () => "inngest",
}));

import { buildJobsHealthSummary } from "../health-summary";
import { resetMetricCountersForTests, incrementMetricCounter } from "../metrics";

function countResponse(count: number) {
  return Promise.resolve({ count, data: null, error: null });
}

function rowsResponse(rows: unknown[]) {
  return Promise.resolve({ count: rows.length, data: rows, error: null });
}

describe("buildJobsHealthSummary", () => {
  it("aggregates queue, running, stuck counts and percentiles", async () => {
    resetMetricCountersForTests();
    incrementMetricCounter("jobs_created_total", 5);

    const now = Date.now();
    const admin = {
      from: (table: string) => {
        if (table === "scan_jobs") {
          return {
            select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.head) {
                return {
                  eq: (col: string, value: string) => {
                    if (col === "status" && value === "queued") return countResponse(4);
                    if (col === "status" && value === "running") return countResponse(2);
                    if (col === "status" && value === "failed") {
                      return { gte: () => countResponse(2) };
                    }
                    return countResponse(0);
                  },
                  in: () => ({
                    lt: () => countResponse(1),
                  }),
                };
              }
              return {
                eq: (col: string, value: string) => {
                  if (col === "status" && value === "running") {
                    return rowsResponse([{ organization_id: "org-a" }, { organization_id: "org-a" }]);
                  }
                  if (col === "status" && value === "queued") {
                    return {
                      order: () => ({
                        limit: () => ({
                          maybeSingle: () =>
                            Promise.resolve({
                              data: { scheduled_at: new Date(now - 120_000).toISOString() },
                              error: null,
                            }),
                        }),
                      }),
                    };
                  }
                  return rowsResponse([]);
                },
              };
            },
          };
        }

        if (table === "scan_job_events") {
          return {
            select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.head) {
                return {
                  eq: (col: string, value: string) => ({
                    gte: () => {
                      if (col === "event_type" && value === "job_retried") return countResponse(3);
                      if (col === "event_type" && value === "job_failed") return countResponse(1);
                      return countResponse(0);
                    },
                    eq: () => ({
                      gte: () => countResponse(1),
                    }),
                  }),
                };
              }
              return {
                eq: (col: string, value: string) => ({
                  gte: () => ({
                    not: () => ({
                      limit: () => {
                        if (col === "event_type" && value === "job_completed") {
                          return rowsResponse([{ duration_ms: 100 }, { duration_ms: 200 }]);
                        }
                        if (col === "event_type" && value === "job_started") {
                          return rowsResponse([{ queue_wait_ms: 1000 }, { queue_wait_ms: 3000 }]);
                        }
                        return rowsResponse([]);
                      },
                    }),
                  }),
                }),
              };
            },
          };
        }

        return {
          select: () => ({
            eq: () => countResponse(0),
          }),
        };
      },
    };

    const summary = await buildJobsHealthSummary(admin as never);
    expect(summary.schedulerMode).toBe("inngest");
    expect(summary.queuedJobs).toBe(4);
    expect(summary.runningJobs).toBe(2);
    expect(summary.failedJobsLast24h).toBe(2);
    expect(summary.retriesLast24h).toBe(3);
    expect(summary.stuckJobs).toBe(1);
    expect(summary.activeJobsByOrganization).toEqual({ "org-a": 2 });
    expect(summary.oldestQueuedJobAgeMs).toBeGreaterThan(60_000);
    expect(summary.durationMs.count).toBe(2);
    expect(summary.queueWaitMs.count).toBe(2);
    expect(summary.inProcessMetricCounters.jobs_created_total).toBe(5);
  });
});
