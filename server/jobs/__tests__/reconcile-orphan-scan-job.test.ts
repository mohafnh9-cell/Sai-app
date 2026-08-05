import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getScanJob: vi.fn(),
  markScanJobCompleted: vi.fn(),
  markScanJobFailed: vi.fn(),
  markScanJobCancelled: vi.fn(),
  executeScanRunJob: vi.fn(),
}));

vi.mock("../scan-job-store", () => ({
  getScanJob: mocks.getScanJob,
  markScanJobCompleted: mocks.markScanJobCompleted,
  markScanJobFailed: mocks.markScanJobFailed,
  markScanJobCancelled: mocks.markScanJobCancelled,
}));

vi.mock("../run-scan-job", () => ({
  executeScanRunJob: mocks.executeScanRunJob,
}));

import { reconcileOrphanScanJobWithTerminalScan } from "../reconcile-orphan-scan-job";

describe("reconcileOrphanScanJobWithTerminalScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks a running job completed when its scan already completed", async () => {
    mocks.getScanJob.mockResolvedValue({
      id: "job-1",
      status: "running",
      job_type: "manual_scan",
      metadata: {},
    });
    mocks.markScanJobCompleted.mockResolvedValue({ updated: true });

    const reconciled = await reconcileOrphanScanJobWithTerminalScan({} as never, {
      jobId: "job-1",
      scan: { id: "scan-1", status: "completed" },
    });

    expect(reconciled).toBe(true);
    expect(mocks.markScanJobCompleted).toHaveBeenCalledWith({}, "job-1");
    expect(mocks.executeScanRunJob).not.toHaveBeenCalled();
  });

  it("runs finalize recovery when scan completed but finalize is pending", async () => {
    mocks.getScanJob.mockResolvedValue({
      id: "job-2",
      status: "running",
      job_type: "automatic_review",
      metadata: { finalize: { kind: "automatic_review" } },
    });
    mocks.executeScanRunJob.mockResolvedValue(undefined);

    const reconciled = await reconcileOrphanScanJobWithTerminalScan({} as never, {
      jobId: "job-2",
      scan: {
        id: "scan-2",
        status: "completed",
        organization_id: "org",
        repository_id: "repo",
      },
    });

    expect(reconciled).toBe(true);
    expect(mocks.executeScanRunJob).toHaveBeenCalled();
  });

  it("marks failed jobs when scan already failed", async () => {
    mocks.getScanJob.mockResolvedValue({
      id: "job-3",
      status: "queued",
      job_type: "manual_scan",
      metadata: {},
    });
    mocks.markScanJobFailed.mockResolvedValue({ updated: true });

    const reconciled = await reconcileOrphanScanJobWithTerminalScan({} as never, {
      jobId: "job-3",
      scan: {
        id: "scan-3",
        status: "failed",
        error_code: "SCAN_FAILED",
        error_message: "boom",
      },
    });

    expect(reconciled).toBe(true);
    expect(mocks.markScanJobFailed).toHaveBeenCalled();
  });
});
