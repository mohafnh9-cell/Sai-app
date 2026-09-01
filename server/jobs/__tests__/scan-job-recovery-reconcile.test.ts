import { describe, expect, it, vi, beforeEach } from "vitest";

// Regression coverage for the M6 audit fix in server/jobs/recovery.ts:
// 1. The "scan already completed, job stuck running" branch must call
//    executeScanRunJob with reconcileOnly so it can actually finalize
//    (see scan-job-reconcile.test.ts for why the claim would otherwise
//    never succeed).
// 2. Any unexpected error during that reconciliation, or during a normal
//    re-enqueue, must mark the job FAILED in the database -- not just
//    increment an in-memory counter that's thrown away when the function
//    returns (the original bug: `catch { summary.failed += 1; }` never
//    wrote anything to scan_jobs).

const executeScanRunJobMock = vi.fn();
const reenqueueExistingScanRunJobMock = vi.fn();
const markScanJobFailedMock = vi.fn();
const markScanJobCompletedMock = vi.fn();
const recoverScanJobToQueuedMock = vi.fn();
const getScanJobMock = vi.fn();
const findStuckScanJobsMock = vi.fn();
const findJobsNeedingFinalizeMock = vi.fn();

vi.mock("../run-scan-job", () => ({
  executeScanRunJob: (...args: unknown[]) => executeScanRunJobMock(...args),
}));

vi.mock("../scan-execution/enqueue-scan-run", async () => {
  const actual = await vi.importActual<typeof import("../scan-execution/enqueue-scan-run")>(
    "../scan-execution/enqueue-scan-run"
  );
  return {
    ScanEnqueueError: actual.ScanEnqueueError,
    reenqueueExistingScanRunJob: (...args: unknown[]) => reenqueueExistingScanRunJobMock(...args),
  };
});

vi.mock("../schedule-scan", () => ({
  processWebhookJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/observability/operational-events", () => ({
  emitOperationalEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/observability/health-summary", () => ({
  buildJobsHealthSummary: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/server/observability/alert-routing", () => ({
  evaluateOperationalAlerts: vi.fn().mockReturnValue({ alerts: [] }),
  emitOperationalAlerts: vi.fn().mockResolvedValue(undefined),
  fetchAlertWindowMetrics: vi.fn().mockResolvedValue({}),
}));

vi.mock("../scan-job-store", () => ({
  findStuckScanJobs: (...args: unknown[]) => findStuckScanJobsMock(...args),
  findJobsNeedingFinalize: (...args: unknown[]) => findJobsNeedingFinalizeMock(...args),
  markScanJobFailed: (...args: unknown[]) => markScanJobFailedMock(...args),
  markScanJobCompleted: (...args: unknown[]) => markScanJobCompletedMock(...args),
  recoverScanJobToQueued: (...args: unknown[]) => recoverScanJobToQueuedMock(...args),
  getScanJob: (...args: unknown[]) => getScanJobMock(...args),
}));

function stuckRunningJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job-stuck",
    organization_id: "org-1",
    project_id: "project-1",
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
    recovery_attempts: 0,
    max_recovery_attempts: 3,
    locked_at: null,
    locked_by: null,
    queue_wait_ms: null,
    duration_ms: null,
    ...overrides,
  };
}

function adminMock(scanStatus: string) {
  return {
    from: (table: string) => {
      if (table === "scans") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { status: scanStatus } }) }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) };
    },
  };
}

describe("runScanJobRecovery — reconciliation and failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markScanJobFailedMock.mockResolvedValue({ updated: true });
    markScanJobCompletedMock.mockResolvedValue({ updated: true });
    findJobsNeedingFinalizeMock.mockResolvedValue([]);
  });

  it("reconciles a stuck-running job whose scan already completed, using reconcileOnly", async () => {
    executeScanRunJobMock.mockResolvedValue(undefined);
    const admin = adminMock("completed");
    const job = stuckRunningJob();
    findStuckScanJobsMock.mockResolvedValue([job]);

    const { runScanJobRecovery } = await import("../recovery");
    const summary = await runScanJobRecovery(admin as never);

    expect(executeScanRunJobMock).toHaveBeenCalledTimes(1);
    const [, , callOptions] = executeScanRunJobMock.mock.calls[0];
    expect(callOptions).toMatchObject({ lockedBy: "recovery-reconcile", reconcileOnly: true });
    expect(summary.finalized).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it("marks the job FAILED in the database when reconciliation throws an unexpected error", async () => {
    executeScanRunJobMock.mockRejectedValue(new Error("boom: unexpected reconcile failure"));
    const admin = adminMock("completed");
    const job = stuckRunningJob();
    findStuckScanJobsMock.mockResolvedValue([job]);

    const { runScanJobRecovery } = await import("../recovery");
    const summary = await runScanJobRecovery(admin as never);

    // This is the actual regression check: the original code only did
    // `summary.failed += 1` in-memory and never called markScanJobFailed,
    // so a permanently-broken reconciliation left the row at "running"
    // forever with zero trace in the database.
    expect(markScanJobFailedMock).toHaveBeenCalledWith(
      admin,
      "job-stuck",
      expect.objectContaining({
        failureCode: "RECOVERY_RECONCILE_FAILED",
        failureMessage: expect.stringContaining("boom"),
      })
    );
    expect(summary.failed).toBe(1);
  });

  it("marks the job FAILED for a non-ScanEnqueueError thrown during a normal re-enqueue", async () => {
    reenqueueExistingScanRunJobMock.mockRejectedValue(new TypeError("cannot read property of undefined"));
    const admin = adminMock("running");
    const job = stuckRunningJob({ status: "queued" });

    findStuckScanJobsMock.mockResolvedValue([job]);
    recoverScanJobToQueuedMock.mockResolvedValue({ recovered: true, job });
    getScanJobMock.mockResolvedValue({ ...job, status: "failed" });

    const { runScanJobRecovery } = await import("../recovery");
    await runScanJobRecovery(admin as never);

    // Old behavior: `if (error instanceof ScanEnqueueError)` meant a plain
    // TypeError (or any non-ScanEnqueueError) silently skipped the DB write.
    expect(markScanJobFailedMock).toHaveBeenCalledWith(
      admin,
      "job-stuck",
      expect.objectContaining({
        failureCode: "RECOVERY_REENQUEUE_FAILED",
        failureMessage: expect.stringContaining("cannot read property"),
      })
    );
  });
});
