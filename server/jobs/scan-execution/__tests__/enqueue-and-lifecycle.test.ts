import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { INNGEST_EVENTS } from "@/inngest/events";

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: vi.fn(),
  },
}));

vi.mock("@/server/security-scanner/admin-client", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}));

vi.mock("@/server/jobs/run-scan-job", () => ({
  executeScanRunJob: vi.fn().mockResolvedValue(undefined),
}));

const baseJob = {
  id: "job-1",
  organization_id: "org-1",
  project_id: "project-1",
  scan_id: "scan-1",
  github_delivery_id: null,
  job_type: "mcp_review" as const,
  status: "queued" as const,
  failure_code: null,
  failure_message: null,
  inngest_run_id: null,
  attempt_count: 0,
  max_attempts: 3,
  metadata: {},
  scheduled_at: new Date().toISOString(),
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

function buildAdmin(options?: {
  scanStatus?: string;
  jobMetadata?: Record<string, unknown>;
}) {
  const scanUpdates: Record<string, unknown>[] = [];
  const jobUpdates: Record<string, unknown>[] = [];
  return {
    scanUpdates,
    jobUpdates,
    admin: {
      from: (table: string) => {
        if (table === "scans") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { status: options?.scanStatus ?? "queued", metadata: {} },
                    error: null,
                  }),
              }),
            }),
            update: (values: Record<string, unknown>) => {
              scanUpdates.push(values);
              return {
                eq: () => ({
                  in: () => ({
                    select: () => ({
                      maybeSingle: () => Promise.resolve({ data: { id: "scan-1" }, error: null }),
                    }),
                  }),
                  maybeSingle: () => Promise.resolve({ data: { id: "scan-1" }, error: null }),
                }),
              };
            },
          };
        }
        if (table === "scan_jobs") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      ...baseJob,
                      metadata: options?.jobMetadata ?? {},
                    },
                    error: null,
                  }),
              }),
            }),
            update: (values: Record<string, unknown>) => {
              jobUpdates.push(values);
              return {
                eq: () => ({
                  in: () => Promise.resolve({ error: null }),
                  then: undefined,
                }),
              };
            },
          };
        }
        if (table === "repository_scan_state") {
          return {
            update: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
          };
        }
      },
    },
  };
}

describe("enqueueScanRunExecution", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SCAN_SCHEDULER = "inngest";
    process.env.INNGEST_EVENT_KEY = "event-key";
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("awaits inngest send and persists event id", async () => {
    const { inngest } = await import("@/inngest/client");
    vi.mocked(inngest.send).mockResolvedValue({ ids: ["evt-123"] } as never);

    const { admin } = buildAdmin();
    const { enqueueScanRunExecution } = await import("../enqueue-scan-run");

    const result = await enqueueScanRunExecution(
      admin as never,
      baseJob,
      {
        scanJobId: baseJob.id,
        scanId: "scan-1",
        organizationId: "org-1",
        projectId: "project-1",
        userId: "user-1",
      },
      { commitSha: "abc123" }
    );

    expect(inngest.send).toHaveBeenCalledWith({
      name: INNGEST_EVENTS.SCAN_RUN,
      data: expect.objectContaining({ scanJobId: "job-1", scanId: "scan-1" }),
    });
    expect(result.executor).toBe("inngest");
    expect(result.inngestEventId).toBe("evt-123");
  });

  it("marks review failed when inngest send fails", async () => {
    const { inngest } = await import("@/inngest/client");
    vi.mocked(inngest.send).mockRejectedValue(new Error("network down"));

    const { admin, scanUpdates } = buildAdmin();
    const { enqueueScanRunExecution, ScanEnqueueError } = await import("../enqueue-scan-run");

    await expect(
      enqueueScanRunExecution(
        admin as never,
        baseJob,
        {
          scanJobId: baseJob.id,
          scanId: "scan-1",
          organizationId: "org-1",
          projectId: "project-1",
          userId: "user-1",
        }
      )
    ).rejects.toBeInstanceOf(ScanEnqueueError);

    expect(scanUpdates.some((u) => u.status === "failed" && u.error_code === "enqueue_failed")).toBe(
      true
    );
  });

  it("marks review failed when inngest returns no event id", async () => {
    const { inngest } = await import("@/inngest/client");
    vi.mocked(inngest.send).mockResolvedValue({ ids: [] } as never);

    const { admin, scanUpdates } = buildAdmin();
    const { enqueueScanRunExecution } = await import("../enqueue-scan-run");

    await expect(
      enqueueScanRunExecution(
        admin as never,
        baseJob,
        {
          scanJobId: baseJob.id,
          scanId: "scan-1",
          organizationId: "org-1",
          projectId: "project-1",
          userId: "user-1",
        }
      )
    ).rejects.toThrow(/event id/);

    expect(scanUpdates.some((u) => u.error_code === "enqueue_failed")).toBe(true);
  });

  it("fails enqueue for org excluded from allowlist without inline fallback", async () => {
    process.env.INNGEST_ASYNC_ORG_ALLOWLIST = "other-org";
    delete process.env.SCAN_SCHEDULER_ORG_FALLBACK;

    const { admin, scanUpdates } = buildAdmin();
    const { enqueueScanRunExecution } = await import("../enqueue-scan-run");

    await expect(
      enqueueScanRunExecution(
        admin as never,
        baseJob,
        {
          scanJobId: baseJob.id,
          scanId: "scan-1",
          organizationId: "org-1",
          projectId: "project-1",
          userId: "user-1",
        }
      )
    ).rejects.toThrow(/INNGEST_ASYNC_ORG_ALLOWLIST/);

    expect(scanUpdates.length).toBeGreaterThan(0);
  });

  it("schedules inline worker when configured inline", async () => {
    process.env.SCAN_SCHEDULER = "inline";
    const scheduler = vi.fn((fn: () => void | Promise<void>) => {
      void fn();
    });

    const { admin } = buildAdmin();
    const { executeScanRunJob } = await import("@/server/jobs/run-scan-job");
    const { enqueueScanRunExecution } = await import("../enqueue-scan-run");

    const result = await enqueueScanRunExecution(
      admin as never,
      baseJob,
      {
        scanJobId: baseJob.id,
        scanId: "scan-1",
        organizationId: "org-1",
        projectId: "project-1",
        userId: "user-1",
      },
      { scheduler }
    );

    expect(result.executor).toBe("inline");
    expect(scheduler).toHaveBeenCalledTimes(1);
  });
});

describe("beginReviewProcessing", () => {
  it("transitions queued review to fetching_repository", async () => {
    const updates: Record<string, unknown>[] = [];
    const admin = {
      from: (table: string) => {
        if (table === "scans") {
          return {
            update: (values: Record<string, unknown>) => {
              updates.push(values);
              return {
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      maybeSingle: () => Promise.resolve({ data: { id: "scan-1" }, error: null }),
                    }),
                  }),
                }),
              };
            },
          };
        }
        if (table === "scan_jobs") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { metadata: {} }, error: null }),
              }),
            }),
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          };
        }
        return {
          update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
        };
      },
    };

    const { beginReviewProcessing } = await import("../review-lifecycle");
    const started = await beginReviewProcessing(admin as never, {
      reviewId: "scan-1",
      scanJobId: "job-1",
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(started).toBe(true);
    expect(updates[0]).toMatchObject({
      status: "fetching_repository",
      processing_started_at: expect.any(String),
    });
  });
});
