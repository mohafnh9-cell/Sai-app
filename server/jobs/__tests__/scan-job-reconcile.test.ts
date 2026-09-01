import { describe, expect, it, vi, beforeEach } from "vitest";

// Regression coverage for the 13-day-stuck-scan-job bug found in the M6
// audit: a scan_jobs row stuck at status "running" (its worker was killed
// mid-flight) whose underlying `scans` row already reached "completed" can
// NEVER be re-claimed by the normal queued->running transition --
// ALLOWED_SOURCE_STATUSES.running only permits "queued" as the source
// status (server/jobs/job-transitions.ts). Without reconcileOnly, recovery
// loops forever logging "scan_job_already_running" and never finalizes.
//
// The existing run-scan-job.test.ts admin mock always succeeds on update()
// regardless of the current status, so it can't reproduce this -- that's
// exactly why the bug went unnoticed by the existing suite. This mock
// enforces the real transition table for the "running" update specifically.

const runMock = vi.fn();

vi.mock("@/server/github-automation/token-resolver", () => ({
  resolveOrganizationGitHubToken: vi.fn(),
}));

vi.mock("@/server/security-scanner/scan-job-runner", () => ({
  InlineScanJobRunner: class {
    run = runMock;
  },
}));

vi.mock("@/server/production-verdict/ensure-verdict-for-scan", () => ({
  ensureProductionVerdictForCompletedScan: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/cache/read-cache", () => ({
  invalidateProjectCache: vi.fn(),
}));

/**
 * Models ALLOWED_SOURCE_STATUSES.running = ["queued"] for real: an update
 * that sets status="running" only "matches" (returns a row) when the job's
 * CURRENT in-memory status is "queued" -- exactly like the real
 * `.in("status", allowedFrom)` filter in transitionScanJob.
 */
function createRealisticAdminMock(initialStatus: string, scanStatus: string) {
  const jobRow: Record<string, unknown> = {
    id: "job-stuck",
    organization_id: "org-1",
    project_id: "project-1",
    scan_id: "scan-1",
    github_delivery_id: null,
    job_type: "manual_scan",
    status: initialStatus,
    failure_code: null,
    failure_message: null,
    inngest_run_id: null,
    attempt_count: 1,
    max_attempts: 3,
    metadata: {},
    scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    started_at: new Date(Date.now() - 60_000).toISOString(),
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
  const updates: Array<Record<string, unknown>> = [];

  const admin = {
    from: (table: string) => {
      if (table === "scan_jobs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { ...jobRow }, error: null }),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            updates.push(values);
            return {
              eq: () => ({
                in: (_col: string, allowed: string[]) => ({
                  select: () => ({
                    maybeSingle: () => {
                      const matches = allowed.includes(jobRow.status as string);
                      if (matches && values.status) {
                        jobRow.status = values.status;
                        Object.assign(jobRow, values);
                      }
                      return Promise.resolve({
                        data: matches ? { ...jobRow } : null,
                        error: null,
                      });
                    },
                  }),
                }),
                // markScanJobCompleted/Failed use a plain .eq(id).eq(status-ish) shape
                // in some call sites without .in(); accept unconditionally there.
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            };
          },
        };
      }
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { github_repo: "acme/app" } }) }),
          }),
        };
      }
      if (table === "scans") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { status: scanStatus, commit_sha: "abc123" } }),
              single: () => Promise.resolve({ data: { status: scanStatus, commit_sha: "abc123" } }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) };
    },
    updates,
    jobRow,
  };

  return admin;
}

describe("executeScanRunJob — stuck-running reconciliation (M6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runMock.mockReset();
  });

  it("reproduces the bug: a job stuck at 'running' can never be re-claimed without reconcileOnly", async () => {
    const admin = createRealisticAdminMock("running", "completed");
    const { executeScanRunJob } = await import("../run-scan-job");

    // No reconcileOnly -- this is exactly what the old recovery.ts code path did.
    await executeScanRunJob(admin as never, {
      scanJobId: "job-stuck",
      scanId: "scan-1",
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
    });

    // Confirms the failure mode: no status transition happens at all --
    // the job is left exactly as stuck as it started.
    expect(admin.jobRow.status).toBe("running");
    expect(admin.updates.some((u) => u.status === "completed")).toBe(false);
    expect(admin.updates.some((u) => u.status === "failed")).toBe(false);
  });

  it("fixes it: reconcileOnly finalizes a stuck-running job whose scan already completed", async () => {
    const admin = createRealisticAdminMock("running", "completed");
    const { executeScanRunJob } = await import("../run-scan-job");
    const { ensureProductionVerdictForCompletedScan } = await import(
      "@/server/production-verdict/ensure-verdict-for-scan"
    );

    await executeScanRunJob(
      admin as never,
      {
        scanJobId: "job-stuck",
        scanId: "scan-1",
        organizationId: "org-1",
        projectId: "project-1",
        userId: "user-1",
      },
      { lockedBy: "recovery-reconcile", reconcileOnly: true }
    );

    expect(runMock).not.toHaveBeenCalled();
    expect(admin.jobRow.status).toBe("completed");
    expect(ensureProductionVerdictForCompletedScan).toHaveBeenCalled();
  });

  it("reconcileOnly does not bypass terminal-state handling (no double completion)", async () => {
    const admin = createRealisticAdminMock("completed", "completed");
    const { executeScanRunJob } = await import("../run-scan-job");

    await executeScanRunJob(
      admin as never,
      {
        scanJobId: "job-stuck",
        scanId: "scan-1",
        organizationId: "org-1",
        projectId: "project-1",
        userId: "user-1",
      },
      { reconcileOnly: true }
    );

    expect(runMock).not.toHaveBeenCalled();
    // Already terminal -- executeScanRunJob returns early, no further updates.
    expect(admin.updates).toHaveLength(0);
  });
});
