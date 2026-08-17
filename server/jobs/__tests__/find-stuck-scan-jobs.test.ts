import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/observability/metrics", () => ({
  incrementMetricCounter: vi.fn(),
}));

import { findStuckScanJobs } from "../scan-job-store";

const baseJob = {
  id: "job-1",
  organization_id: "org-1",
  project_id: "proj-1",
  scan_id: "scan-1",
  github_delivery_id: null,
  job_type: "automatic_review" as const,
  status: "running" as const,
  failure_code: null,
  failure_message: null,
  inngest_run_id: null,
  attempt_count: 1,
  max_attempts: 3,
  metadata: {},
  scheduled_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  completed_at: null,
  failed_at: null,
  cancelled_at: null,
  heartbeat_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  execution_deadline_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  last_recovery_at: null,
  recovery_attempts: 0,
  max_recovery_attempts: 3,
  locked_at: new Date().toISOString(),
  locked_by: "inline-worker",
  queue_wait_ms: 1000,
  duration_ms: null,
};

describe("findStuckScanJobs", () => {
  it("includes running jobs with stale heartbeat before execution deadline", async () => {
    const queries: string[] = [];
    const admin = {
      from: (table: string) => {
        if (table !== "scan_jobs") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: (_col: string, value: string) => {
              queries.push(value);
              if (value === "queued") {
                return {
                  lt: () => ({
                    order: () => ({
                      limit: () => Promise.resolve({ data: [], error: null }),
                    }),
                  }),
                };
              }
              if (value === "running") {
                return {
                  lt: (_col: string, cutoff: string) => ({
                    order: () => ({
                      limit: () =>
                        Promise.resolve({
                          data:
                            cutoff === baseJob.execution_deadline_at
                              ? []
                              : [baseJob],
                          error: null,
                        }),
                    }),
                  }),
                  not: () => ({
                    lt: () => ({
                      order: () => ({
                        limit: () => Promise.resolve({ data: [baseJob], error: null }),
                      }),
                    }),
                  }),
                };
              }
              throw new Error(`unexpected status ${value}`);
            },
          }),
        };
      },
    };

    const stuck = await findStuckScanJobs(admin as never);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.id).toBe("job-1");
    expect(queries).toContain("running");
  });
});
