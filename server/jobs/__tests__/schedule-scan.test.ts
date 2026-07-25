import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getScanSchedulerMode } from "@/lib/env/scan-scheduler";

vi.mock("@/server/security-scanner/admin-client", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}));

vi.mock("@/server/jobs/run-scan-job", () => ({
  executeScanRunJob: vi.fn().mockResolvedValue(undefined),
}));

describe("getScanSchedulerMode", () => {
  const original = process.env.SCAN_SCHEDULER;

  afterEach(() => {
    if (original === undefined) delete process.env.SCAN_SCHEDULER;
    else process.env.SCAN_SCHEDULER = original;
  });

  it("defaults to inline when unset", () => {
    delete process.env.SCAN_SCHEDULER;
    expect(getScanSchedulerMode()).toBe("inline");
  });

  it("accepts inngest mode", () => {
    process.env.SCAN_SCHEDULER = "inngest";
    expect(getScanSchedulerMode()).toBe("inngest");
  });
});

describe("scan job store transitions", () => {
  it("tracks terminal job states with allowed source guards", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: "job",
                  started_at: new Date(Date.now() - 1000).toISOString(),
                  status: "running",
                },
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
                  maybeSingle: () => Promise.resolve({ data: { id: "job", ...values }, error: null }),
                }),
              }),
              then: undefined,
            }),
          };
        },
      }),
    };

    const { markScanJobFailed, markScanJobCompleted, markScanJobCancelled } = await import(
      "../scan-job-store"
    );

    await markScanJobFailed(admin as never, "job-1", {
      failureCode: "SCAN_EXECUTION_FAILED",
      failureMessage: "boom",
    });
    await markScanJobCompleted(admin as never, "job-2");
    await markScanJobCancelled(admin as never, "job-3", {
      failureCode: "JOB_CANCELLED",
      failureMessage: "user cancelled",
    });

    expect(updates[0]).toMatchObject({
      status: "failed",
      failure_code: "SCAN_EXECUTION_FAILED",
      failure_message: "boom",
    });
    expect(updates[1]).toMatchObject({ status: "completed" });
    expect(updates[2]).toMatchObject({ status: "cancelled" });
  });
});

describe("scheduleScanRun inline path", () => {
  beforeEach(() => {
    process.env.SCAN_SCHEDULER = "inline";
  });

  it("creates a scan job and schedules inline execution", async () => {
    const inserted: Record<string, unknown>[] = [];
    const admin = {
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => {
          if (table !== "scan_jobs") return Promise.resolve({ error: null });
          inserted.push(row);
          return {
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "job-123", ...row },
                  error: null,
                }),
            }),
          };
        },
      }),
    };

    const scheduler = vi.fn((fn: () => void | Promise<void>) => {
      void fn();
    });

    const { scheduleScanRun } = await import("../schedule-scan");
    const result = await scheduleScanRun(
      admin as never,
      {
        scanJobId: "",
        scanId: "scan-1",
        organizationId: "org-1",
        projectId: "project-1",
        userId: "user-1",
        jobType: "manual_scan",
      },
      { scheduler }
    );

    expect(result.duplicate).toBe(false);
    expect(result.scanJobId).toBe("job-123");
    expect(inserted[0]).toMatchObject({
      organization_id: "org-1",
      scan_id: "scan-1",
      job_type: "manual_scan",
      status: "queued",
    });
    expect(scheduler).toHaveBeenCalledTimes(1);
  });
});

describe("webhook duplicate ingress", () => {
  it("treats existing ingress jobs as duplicates", async () => {
    vi.doMock("@/server/github-automation/delivery-idempotency", () => ({
      isDeliveryAlreadyHandled: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("@/server/jobs/scan-job-store", () => ({
      findWebhookIngressJob: vi.fn().mockResolvedValue({ status: "completed" }),
      createScanJob: vi.fn(),
    }));

    const { isDeliveryAlreadyHandled } = await import(
      "@/server/github-automation/delivery-idempotency"
    );
    const { findWebhookIngressJob } = await import("@/server/jobs/scan-job-store");

    vi.mocked(isDeliveryAlreadyHandled).mockResolvedValue(false);
    vi.mocked(findWebhookIngressJob).mockResolvedValue({
      id: "job-1",
      status: "completed",
    } as never);

    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: { organization_id: "org-1" } }),
            }),
          }),
        }),
      }),
    };

    vi.mocked((await import("@/server/security-scanner/admin-client")).createAdminClient).mockReturnValue(
      admin as never
    );

    const { ingestGitHubWebhook } = await import("../webhook-ingress");
    const result = await ingestGitHubWebhook({
      deliveryId: "delivery-1",
      eventType: "push",
      payload: { repository: { id: 99 } },
    });

    expect(result.status).toBe("duplicate");
  });
});
