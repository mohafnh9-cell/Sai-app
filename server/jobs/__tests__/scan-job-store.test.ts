import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/observability/operational-events", () => ({
  emitOperationalEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  claimScanJob,
  createScanJob,
  markScanJobCompleted,
  markScanJobFailed,
} from "../scan-job-store";

const baseJob = {
  id: "job-1",
  organization_id: "org-1",
  project_id: "proj-1",
  scan_id: "scan-1",
  github_delivery_id: null,
  job_type: "manual_scan" as const,
  status: "queued" as const,
  failure_code: null,
  failure_message: null,
  inngest_run_id: null,
  attempt_count: 1,
  max_attempts: 3,
  metadata: {},
  scheduled_at: new Date(Date.now() - 5000).toISOString(),
  started_at: null,
  completed_at: null,
  failed_at: null,
  cancelled_at: null,
  heartbeat_at: null,
  execution_deadline_at: null,
  last_recovery_at: null,
  recovery_attempts: 0,
  max_recovery_attempts: 3,
  locked_at: null,
  locked_by: null,
  queue_wait_ms: null,
  duration_ms: null,
};

function createTransitionAdmin(initialStatus: "queued" | "running" | "completed") {
  let status = initialStatus;
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { ...baseJob, status },
              error: null,
            }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (col: string, id: string) => ({
          in: (_col: string, allowed: string[]) => {
            if (table !== "scan_jobs" || id !== baseJob.id || !allowed.includes(status)) {
              return {
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              };
            }
            status = values.status as typeof status;
            return {
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { ...baseJob, status, ...values },
                    error: null,
                  }),
              }),
            };
          },
        }),
      }),
    }),
  };
}

describe("claimScanJob", () => {
  it("claims a queued job atomically", async () => {
    const admin = createTransitionAdmin("queued");
    const result = await claimScanJob(admin as never, baseJob.id, { lockedBy: "worker-1" });
    expect(result.claimed).toBe(true);
    expect(result.job?.status).toBe("running");
  });

  it("does not claim a completed job", async () => {
    const admin = createTransitionAdmin("completed");
    const result = await claimScanJob(admin as never, baseJob.id, { lockedBy: "worker-1" });
    expect(result.claimed).toBe(false);
  });
});

describe("duplicate completion attempts", () => {
  it("ignores second completion when job is already completed", async () => {
    const admin = createTransitionAdmin("completed");
    const result = await markScanJobCompleted(admin as never, baseJob.id);
    expect(result.updated).toBe(false);
  });

  it("marks running job as completed once", async () => {
    const admin = createTransitionAdmin("running");
    const result = await markScanJobCompleted(admin as never, baseJob.id);
    expect(result.updated).toBe(true);
  });

  it("ignores failure transition from completed terminal state", async () => {
    const admin = createTransitionAdmin("completed");
    const result = await markScanJobFailed(admin as never, baseJob.id, {
      failureCode: "TEST",
      failureMessage: "late failure",
    });
    expect(result.updated).toBe(false);
  });
});

describe("createScanJob duplicate protection", () => {
  it("returns duplicate=true on unique constraint conflicts", async () => {
    const admin = {
      from: () => ({
        insert: () => ({
          select: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: null,
                error: { code: "23505", message: "duplicate key" },
              }),
          }),
        }),
      }),
    };

    const result = await createScanJob(admin as never, {
      organizationId: "org-1",
      githubDeliveryId: "delivery-123",
      jobType: "webhook_process",
    });

    expect(result.duplicate).toBe(true);
    expect(result.job).toBeNull();
  });

  it("creates a queued job for a new delivery id", async () => {
    const admin = {
      from: () => ({
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: "job-new", ...row },
                error: null,
              }),
          }),
        }),
      }),
    };

    const result = await createScanJob(admin as never, {
      organizationId: "org-1",
      githubDeliveryId: "delivery-new",
      jobType: "webhook_process",
    });

    expect(result.duplicate).toBe(false);
    expect(result.job).toMatchObject({
      id: "job-new",
      status: "queued",
      job_type: "webhook_process",
    });
  });
});

describe("retry configuration", () => {
  it("uses three max attempts by default", async () => {
    const { SCAN_JOB_DEFAULT_MAX_ATTEMPTS } = await import("../types");
    expect(SCAN_JOB_DEFAULT_MAX_ATTEMPTS).toBe(3);
  });
});
