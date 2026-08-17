import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  after: (fn: () => void | Promise<void>) => {
    void fn();
  },
}));

vi.mock("@/server/jobs/scan-execution/scan-execution-trace", () => ({
  logScanExecutionTrace: vi.fn(),
}));

const enqueueScanRunExecution = vi.fn().mockResolvedValue({
  executor: "inline",
  inngestEventId: null,
});

vi.mock("@/server/jobs/scan-execution/enqueue-scan-run", () => ({
  enqueueScanRunExecution,
  ScanEnqueueError: class ScanEnqueueError extends Error {
    code = "enqueue_failed";
  },
}));

describe("scheduleScanRun re-enqueue", () => {
  beforeEach(() => {
    enqueueScanRunExecution.mockClear();
  });

  it("re-enqueues an existing queued job instead of returning silently", async () => {
    const existingJob = {
      id: "job-existing",
      organization_id: "org-1",
      project_id: "project-1",
      scan_id: "scan-1",
      status: "queued",
      metadata: {},
      scheduled_at: new Date().toISOString(),
    };

    const admin = {
      from: (table: string) => {
        if (table === "scan_jobs") {
          return {
            insert: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { code: "23505", message: "duplicate" },
                }),
              }),
            }),
            select: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: existingJob, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const { scheduleScanRun } = await import("../schedule-scan");
    const result = await scheduleScanRun(admin as never, {
      scanJobId: "",
      scanId: "scan-1",
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      scanType: "full",
    });

    expect(result.duplicate).toBe(true);
    expect(result.scanJobId).toBe("job-existing");
    expect(enqueueScanRunExecution).toHaveBeenCalledTimes(1);
  });

  it("does not re-enqueue when the existing job is already running", async () => {
    const existingJob = {
      id: "job-running",
      organization_id: "org-1",
      project_id: "project-1",
      scan_id: "scan-1",
      status: "running",
      metadata: {},
      scheduled_at: new Date().toISOString(),
    };

    const admin = {
      from: (table: string) => {
        if (table === "scan_jobs") {
          return {
            insert: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { code: "23505", message: "duplicate" },
                }),
              }),
            }),
            select: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: existingJob, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const { scheduleScanRun } = await import("../schedule-scan");
    const result = await scheduleScanRun(admin as never, {
      scanJobId: "",
      scanId: "scan-1",
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      scanType: "full",
    });

    expect(result.duplicate).toBe(true);
    expect(result.scanJobId).toBe("job-running");
    expect(enqueueScanRunExecution).not.toHaveBeenCalled();
  });
});
