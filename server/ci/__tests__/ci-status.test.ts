import { describe, expect, it, vi, beforeEach } from "vitest";
import { findScanByCommitSha } from "../find-scan-by-sha";
import { getCiEnforcementStatus } from "../ci-enforcement-service";

vi.mock("@/lib/repository-sync/commits-match", () => ({
  commitsMatch: (a: string, b: string) => a.toLowerCase() === b.toLowerCase(),
}));

vi.mock("@/server/pull-request/get-pr-verdict", () => ({
  getLatestPullRequestScan: vi.fn(),
  isPullRequestVerdictStale: vi.fn(),
}));

vi.mock("@/server/production-verdict/service", () => ({
  getProductionVerdictByScan: vi.fn(),
}));

import { getLatestPullRequestScan, isPullRequestVerdictStale } from "@/server/pull-request/get-pr-verdict";
import { getProductionVerdictByScan } from "@/server/production-verdict/service";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

const mockVerdict = (status: ProductionVerdictV1["status"]): ProductionVerdictV1 =>
  ({
    status,
    score: 90,
    blockersCount: 0,
    topPriorities: [],
    executiveSummary: "GO",
    generatedAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as ProductionVerdictV1;

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const COMMIT = "abc123def4567890abcdef1234567890abcdef12";

function buildAdmin(input: {
  active?: Array<Record<string, unknown>>;
  recent?: Array<Record<string, unknown>>;
}) {
  return {
    from: (table: string) => {
      if (table !== "scans") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_col: string, _val: string) => ({
            in: (_col2: string, statuses: string[]) => ({
              order: () => ({
                limit: () => {
                  const isActive = statuses.includes("queued");
                  return Promise.resolve({
                    data: isActive ? input.active ?? [] : input.recent ?? [],
                    error: null,
                  });
                },
              }),
            }),
          }),
        }),
      };
    },
  } as never;
}

describe("findScanByCommitSha", () => {
  it("returns active scan for matching SHA across review types", async () => {
    const admin = buildAdmin({
      active: [{ id: "scan-1", status: "scanning", commit_sha: COMMIT, review_type: "automatic" }],
    });
    const result = await findScanByCommitSha(admin, { projectId: PROJECT, commitSha: COMMIT });
    expect(result).toEqual({
      state: "active",
      scan: expect.objectContaining({ id: "scan-1" }),
    });
  });

  it("returns completed scan when no active match", async () => {
    const admin = buildAdmin({
      recent: [{ id: "scan-done", status: "completed", commit_sha: COMMIT, review_type: "manual" }],
    });
    const result = await findScanByCommitSha(admin, { projectId: PROJECT, commitSha: COMMIT });
    expect(result.state).toBe("completed");
  });
});

describe("getCiEnforcementStatus", () => {
  beforeEach(() => {
    vi.mocked(getLatestPullRequestScan).mockReset();
    vi.mocked(isPullRequestVerdictStale).mockReset();
    vi.mocked(getProductionVerdictByScan).mockReset();
  });

  it("uses PR scan path when prNumber is provided", async () => {
    vi.mocked(getLatestPullRequestScan).mockResolvedValue({
      id: "prs-1",
      projectId: PROJECT,
      organizationId: ORG,
      pullRequestNumber: 7,
      pullRequestTitle: "feat",
      baseBranch: "main",
      headBranch: "feat",
      baseCommitSha: "base",
      headCommitSha: COMMIT,
      scanId: "scan-pr",
      scanStatus: "completed",
      checkStatus: "passed",
      verdictStatus: "ready_to_ship",
      score: 90,
      blockersCount: 0,
      topBlockers: [],
      productionVerdict: mockVerdict("ready_to_ship"),
      githubCheckRunId: 99,
      source: "pr",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      stale: false,
    });
    vi.mocked(isPullRequestVerdictStale).mockResolvedValue(false);

    const admin = buildAdmin({});
    const status = await getCiEnforcementStatus(admin, {
      projectId: PROJECT,
      organizationId: ORG,
      commitSha: COMMIT,
      prNumber: 7,
    });

    expect(status.source).toBe("pr");
    expect(status.checkRun.conclusion).toBe("success");
    expect(status.stale).toBe(false);
    expect(status.correlation.ready).toBe(true);
  });

  it("marks stale PR verdict and fails closed on check conclusion", async () => {
    vi.mocked(getLatestPullRequestScan).mockResolvedValue({
      id: "prs-old",
      projectId: PROJECT,
      organizationId: ORG,
      pullRequestNumber: 7,
      pullRequestTitle: null,
      baseBranch: null,
      headBranch: null,
      baseCommitSha: null,
      headCommitSha: "oldsha111111111111111111111111111111111111",
      scanId: "scan-old",
      scanStatus: "completed",
      checkStatus: "passed",
      verdictStatus: "ready_to_ship",
      score: 90,
      blockersCount: 0,
      topBlockers: [],
      productionVerdict: mockVerdict("ready_to_ship"),
      githubCheckRunId: null,
      source: "pr",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      stale: false,
    });
    vi.mocked(isPullRequestVerdictStale).mockResolvedValue(true);

    const admin = buildAdmin({});
    const status = await getCiEnforcementStatus(admin, {
      projectId: PROJECT,
      organizationId: ORG,
      commitSha: COMMIT,
      prNumber: 7,
    });

    expect(status.stale).toBe(true);
    expect(status.correlation.ready).toBe(false);
    expect(status.ok).toBe(false);
    expect(status.checkRun.conclusion).not.toBe("success");
    expect(status.checkRun.conclusion).toBe("neutral");
  });

  it("falls back to commit scan lookup for push context", async () => {
    vi.mocked(getProductionVerdictByScan).mockResolvedValue(mockVerdict("not_ready"));

    const admin = buildAdmin({
      recent: [{ id: "scan-push", status: "completed", commit_sha: COMMIT, review_type: "automatic" }],
    });

    const status = await getCiEnforcementStatus(admin, {
      projectId: PROJECT,
      organizationId: ORG,
      commitSha: COMMIT,
    });

    expect(status.source).toBe("github");
    expect(status.checkRun.conclusion).toBe("failure");
    expect(getProductionVerdictByScan).toHaveBeenCalledWith(admin, ORG, "scan-push");
  });
});
