import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/observability/operational-events", () => ({
  emitOperationalEvent: vi.fn().mockResolvedValue(undefined),
}));

import { recoverScanJobToQueued } from "../scan-job-store";

describe("recoverScanJobToQueued", () => {
  it("re-enqueues recoverable running jobs", async () => {
    const admin = {
      from: () => ({
        update: (values: Record<string, unknown>) => ({
          eq: () => ({
            in: () => ({
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: "job-2",
                      organization_id: "org-1",
                      project_id: "proj-1",
                      scan_id: "scan-1",
                      github_delivery_id: null,
                      job_type: "manual_scan",
                      status: "queued",
                      failure_code: null,
                      failure_message: null,
                      inngest_run_id: null,
                      attempt_count: 1,
                      max_attempts: 3,
                      metadata: {},
                      scheduled_at: new Date().toISOString(),
                      started_at: null,
                      completed_at: null,
                      failed_at: null,
                      cancelled_at: null,
                      heartbeat_at: null,
                      execution_deadline_at: new Date(Date.now() + 60_000).toISOString(),
                      last_recovery_at: new Date().toISOString(),
                      recovery_attempts: 1,
                      max_recovery_attempts: 3,
                      locked_at: null,
                      locked_by: null,
                      queue_wait_ms: null,
                      duration_ms: null,
                    },
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    };

    const job = {
      id: "job-2",
      organization_id: "org-1",
      project_id: "proj-1",
      scan_id: "scan-1",
      github_delivery_id: null,
      job_type: "manual_scan" as const,
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
      heartbeat_at: null,
      execution_deadline_at: new Date(Date.now() - 1000).toISOString(),
      last_recovery_at: null,
      recovery_attempts: 0,
      max_recovery_attempts: 3,
      locked_at: null,
      locked_by: null,
      queue_wait_ms: null,
      duration_ms: null,
    };

    const result = await recoverScanJobToQueued(admin as never, job, {
      lockedBy: "recovery-cron",
    });
    expect(result.recovered).toBe(true);
    expect(result.job?.status).toBe("queued");
  });

  it("fails permanently when recovery attempts are exhausted", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: "job-1", status: "failed" },
                error: null,
              }),
          }),
        }),
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return {
            eq: () => ({
              in: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: "job-1" }, error: null }),
                }),
              }),
            }),
          };
        },
      }),
    };

    const job = {
      id: "job-1",
      organization_id: "org-1",
      project_id: "proj-1",
      scan_id: "scan-1",
      github_delivery_id: null,
      job_type: "manual_scan",
      status: "running",
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
      heartbeat_at: null,
      execution_deadline_at: null,
      last_recovery_at: null,
      recovery_attempts: 3,
      max_recovery_attempts: 3,
      locked_at: null,
      locked_by: null,
      queue_wait_ms: null,
      duration_ms: null,
    } as const;

    const result = await recoverScanJobToQueued(admin as never, job as never, {
      lockedBy: "recovery-cron",
    });
    expect(result.recovered).toBe(false);
    expect(updates.some((row) => row.status === "failed")).toBe(true);
  });
});

describe("load test safety guards", () => {
  it("refuses production hostnames by default", async () => {
    const { assertStagingTarget } = await import("../../../scripts/lib/load-test-guards.mjs");
    expect(() => assertStagingTarget("https://sequrai.com")).toThrow(/blocked host/i);
    expect(() => assertStagingTarget("https://staging.example.com")).not.toThrow();
  });
});
