import { describe, expect, it, vi } from "vitest";
import { scheduleStuckProductionReviewExecution } from "../kick-stuck-scan-run";

vi.mock("next/server", () => ({
  after: (fn: () => void | Promise<void>) => {
    void fn();
  },
}));

describe("scheduleStuckProductionReviewExecution", () => {
  it("schedules kick for queued scan with queued job after grace period", () => {
    const admin = {} as never;
    const old = Date.now() - 60_000;
    const result = scheduleStuckProductionReviewExecution(admin, {
      scan: {
        id: "scan-1",
        status: "queued",
        created_at: new Date(old).toISOString(),
        organization_id: "org",
        project_id: "proj",
        repository_id: "proj",
        commit_sha: "abc",
      },
      scanJob: {
        id: "job-1",
        status: "queued",
        created_at: new Date(old).toISOString(),
      },
    });
    expect(result.scheduled).toBe(true);
    expect(result.reason).toBe("queued_job");
  });

  it("schedules kick for orphan queued scan with running job", () => {
    const admin = {} as never;
    const old = Date.now() - 60_000;
    const result = scheduleStuckProductionReviewExecution(admin, {
      scan: {
        id: "scan-1",
        status: "queued",
        created_at: new Date(old).toISOString(),
        organization_id: "org",
        repository_id: "proj",
      },
      scanJob: {
        id: "job-1",
        status: "running",
        created_at: new Date(old).toISOString(),
      },
    });
    expect(result.scheduled).toBe(true);
    expect(result.reason).toBe("orphan_running_job");
  });
});
