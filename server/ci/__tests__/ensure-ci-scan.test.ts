import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CiProjectAccess } from "../ci-access";

vi.mock("@/lib/github/repository-service", () => ({
  parseGitHubRepository: vi.fn(() => ({ owner: "org", repo: "app" })),
  resolveCommitReference: vi.fn(async () => ({
    sha: "abc123def4567890abcdef1234567890abcdef12",
    branch: "main",
  })),
  GitHubServiceError: class GitHubServiceError extends Error {
    constructor(
      public code: string,
      message: string
    ) {
      super(message);
    }
  },
}));

vi.mock("@/server/github-automation/token-resolver", () => ({
  resolveOrganizationGitHubToken: vi.fn(async () => ({
    token: "gh-token",
    userId: "user-1",
    authSource: "github_app" as const,
  })),
}));

vi.mock("@/server/pull-request/get-pr-verdict", () => ({
  getLatestPullRequestScan: vi.fn(),
  isPullRequestVerdictStale: vi.fn(),
}));

vi.mock("@/server/production-verdict/service", () => ({
  getProductionVerdictByScan: vi.fn(),
}));

vi.mock("@/server/billing/assert-scan-access", () => ({
  assertOrganizationCanRunScan: vi.fn(async () => undefined),
}));

vi.mock("@/server/review-start/release-active-review-for-new-head", () => ({
  releaseActiveReviewForNewHead: vi.fn(async () => undefined),
}));

vi.mock("@/server/jobs/schedule-scan", () => ({
  scheduleScanRun: vi.fn(async () => ({ scanJobId: "job-1", duplicate: false })),
}));

vi.mock("../find-scan-by-sha", () => ({
  findScanByCommitSha: vi.fn(),
}));

import { ensureCiScan } from "../ci-enforcement-service";
import { findScanByCommitSha } from "../find-scan-by-sha";
import { scheduleScanRun } from "@/server/jobs/schedule-scan";
import {
  getLatestPullRequestScan,
  isPullRequestVerdictStale,
} from "@/server/pull-request/get-pr-verdict";
import { getProductionVerdictByScan } from "@/server/production-verdict/service";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const COMMIT = "abc123def4567890abcdef1234567890abcdef12";

function buildAccess(): CiProjectAccess {
  return {
    project: {
      id: PROJECT,
      organization_id: ORG,
      name: "demo",
      github_repo: "org/app",
    },
    userId: "user-1",
    admin: {
      from: (table: string) => {
        if (table === "scans") {
          return {
            insert: (payload: Record<string, unknown>) => ({
              select: () => ({
                single: async () => ({
                  data: { id: "scan-new", ...payload },
                  error: null,
                }),
              }),
            }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === "repository_scan_state") {
          return { upsert: async () => ({ error: null }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never,
    authSource: "api_key",
  };
}

describe("ensureCiScan", () => {
  beforeEach(() => {
    vi.mocked(findScanByCommitSha).mockReset();
    vi.mocked(scheduleScanRun).mockReset();
    vi.mocked(getLatestPullRequestScan).mockReset();
    vi.mocked(isPullRequestVerdictStale).mockReset();
    vi.mocked(getProductionVerdictByScan).mockReset();
    vi.mocked(scheduleScanRun).mockResolvedValue({ scanJobId: "job-1", duplicate: false });
    vi.mocked(isPullRequestVerdictStale).mockResolvedValue(false);
  });

  it("returns awaiting_webhook for PR when no PR scan exists", async () => {
    vi.mocked(getLatestPullRequestScan).mockResolvedValue(null);
    vi.mocked(findScanByCommitSha).mockResolvedValue({ state: "none" });

    const result = await ensureCiScan(buildAccess(), {
      commitSha: COMMIT,
      prNumber: 42,
    });

    expect(result.outcome).toBe("awaiting_webhook");
    expect(scheduleScanRun).not.toHaveBeenCalled();
  });

  it("reuses completed scan for push without scheduling a duplicate", async () => {
    vi.mocked(findScanByCommitSha).mockResolvedValue({
      state: "completed",
      scan: { id: "scan-done", status: "completed", commit_sha: COMMIT },
    });
    vi.mocked(getProductionVerdictByScan).mockResolvedValue({
      status: "ready_to_ship",
    } as never);

    const result = await ensureCiScan(buildAccess(), { commitSha: COMMIT });

    expect(result.outcome).toBe("reused");
    expect(scheduleScanRun).not.toHaveBeenCalled();
    if (result.outcome !== "failed") {
      expect(result.status?.scanPhase).toBe("completed");
    }
  });

  it("resumes active scan for duplicate webhook+CI trigger on same SHA", async () => {
    vi.mocked(findScanByCommitSha).mockResolvedValue({
      state: "active",
      scan: { id: "scan-active", status: "scanning", commit_sha: COMMIT },
    });

    const result = await ensureCiScan(buildAccess(), { commitSha: COMMIT });

    expect(result.outcome).toBe("resumed");
    expect(scheduleScanRun).not.toHaveBeenCalled();
  });

  it("schedules scan only when no existing scan matches SHA", async () => {
    vi.mocked(findScanByCommitSha).mockResolvedValue({ state: "none" });

    const result = await ensureCiScan(buildAccess(), { commitSha: COMMIT });

    expect(result.outcome).toBe("scheduled");
    expect(scheduleScanRun).toHaveBeenCalledOnce();
  });

  it("rejects PR requests when headSha does not match commitSha", async () => {
    const result = await ensureCiScan(buildAccess(), {
      commitSha: COMMIT,
      prNumber: 7,
      headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.code).toBe("PR_SHA_MISMATCH");
    }
  });
});
