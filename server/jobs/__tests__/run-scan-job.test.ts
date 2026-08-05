import { describe, expect, it, vi, beforeEach } from "vitest";

const runMock = vi.fn();

vi.mock("@/server/github-automation/token-resolver", () => ({
  resolveOrganizationGitHubToken: vi.fn(),
}));

vi.mock("@/server/security-scanner/scan-job-runner", () => ({
  InlineScanJobRunner: class {
    constructor() {}
    run = runMock;
  },
}));

vi.mock("@/server/production-verdict/ensure-verdict-for-scan", () => ({
  ensureProductionVerdictForCompletedScan: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/cache/read-cache", () => ({
  invalidateProjectCache: vi.fn(),
}));

function createAdminMock(options?: {
  scanStatus?: string;
  jobStatus?: string;
}) {
  const scanStatus = options?.scanStatus ?? "completed";
  const jobStatus = options?.jobStatus ?? "queued";
  const updates: Array<Record<string, unknown>> = [];
  const jobRow = {
    id: "job-1",
    organization_id: "org-1",
    project_id: "project-1",
    scan_id: "scan-1",
    github_delivery_id: null,
    job_type: "manual_scan",
    status: jobStatus,
    failure_code: null,
    failure_message: null,
    inngest_run_id: null,
    attempt_count: 1,
    max_attempts: 3,
    metadata: {},
    scheduled_at: new Date(Date.now() - 1000).toISOString(),
    started_at: jobStatus === "running" ? new Date(Date.now() - 500).toISOString() : null,
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

  const admin = {
    from: (table: string) => {
      if (table === "scan_jobs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: jobRow,
                  error: null,
                }),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            updates.push(values);
            if (values.status) jobRow.status = values.status as typeof jobStatus;
            const updateResult = {
              eq: (_col: string, _id: string) => ({
                in: () => ({
                  select: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { ...jobRow, ...values },
                        error: null,
                      }),
                  }),
                }),
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            };
            return updateResult;
          },
        };
      }
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { github_repo: "acme/app" } }),
            }),
          }),
        };
      }
      if (table === "scans") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { status: scanStatus, commit_sha: "abc123" },
                }),
              single: () =>
                Promise.resolve({
                  data: { status: scanStatus, commit_sha: "abc123" },
                }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { status: scanStatus } }),
          }),
        }),
      };
    },
    updates,
  };

  return admin;
}

describe("executeScanRunJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runMock.mockReset();
  });

  it("marks jobs failed and rethrows when the runner throws", async () => {
    runMock.mockRejectedValue(new Error("SCAN_EXECUTION_FAILED"));

    const { resolveOrganizationGitHubToken } = await import(
      "@/server/github-automation/token-resolver"
    );
    vi.mocked(resolveOrganizationGitHubToken).mockResolvedValue({
      token: "gh-token",
      userId: "user-1",
    });

    const admin = createAdminMock({ scanStatus: "scanning", jobStatus: "queued" });
    const { executeScanRunJob } = await import("../run-scan-job");

    await expect(
      executeScanRunJob(admin as never, {
        scanJobId: "job-1",
        scanId: "scan-1",
        organizationId: "org-1",
        projectId: "project-1",
        userId: "user-1",
      })
    ).rejects.toThrow("SCAN_EXECUTION_FAILED");

    expect(admin.updates.some((row) => row.status === "failed")).toBe(true);
  });

  it("marks jobs completed when scan finishes successfully", async () => {
    runMock.mockResolvedValue(undefined);

    const { resolveOrganizationGitHubToken } = await import(
      "@/server/github-automation/token-resolver"
    );
    vi.mocked(resolveOrganizationGitHubToken).mockResolvedValue({
      token: "gh-token",
      userId: "user-1",
    });

    const admin = createAdminMock({ scanStatus: "completed", jobStatus: "queued" });
    const { executeScanRunJob } = await import("../run-scan-job");

    await executeScanRunJob(admin as never, {
      scanJobId: "job-2",
      scanId: "scan-2",
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
    });

    expect(admin.updates.some((row) => row.status === "completed")).toBe(true);
  });

  it("skips execution when the job is already terminal", async () => {
    const admin = createAdminMock({ jobStatus: "completed" });
    const { executeScanRunJob } = await import("../run-scan-job");

    await executeScanRunJob(admin as never, {
      scanJobId: "job-3",
      scanId: "scan-3",
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
    });

    expect(runMock).not.toHaveBeenCalled();
  });

  it("skips the runner when the scan is already completed on retry", async () => {
    runMock.mockResolvedValue(undefined);
    const { resolveOrganizationGitHubToken } = await import(
      "@/server/github-automation/token-resolver"
    );
    vi.mocked(resolveOrganizationGitHubToken).mockResolvedValue({
      token: "gh-token",
      userId: "user-1",
    });

    const admin = createAdminMock({ scanStatus: "completed", jobStatus: "running" });
    const { executeScanRunJob } = await import("../run-scan-job");

    await executeScanRunJob(admin as never, {
      scanJobId: "job-4",
      scanId: "scan-4",
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
    });

    expect(runMock).not.toHaveBeenCalled();
    expect(admin.updates.some((row) => row.status === "completed")).toBe(true);
  });
});
