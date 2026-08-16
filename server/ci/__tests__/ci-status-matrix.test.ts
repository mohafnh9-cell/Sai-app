import { describe, expect, it, vi, beforeEach } from "vitest";
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

import { getProductionVerdictByScan } from "@/server/production-verdict/service";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const COMMIT = "abc123def4567890abcdef1234567890abcdef12";

const mockVerdict = (status: ProductionVerdictV1["status"]): ProductionVerdictV1 =>
  ({
    status,
    score: 50,
    blockersCount: 1,
    topPriorities: [],
    executiveSummary: "test",
    generatedAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as ProductionVerdictV1;

function buildAdmin(recent: Array<Record<string, unknown>>) {
  return {
    from: (table: string) => {
      if (table !== "scans") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            in: (_c: string, statuses: string[]) => ({
              order: () => ({
                limit: () =>
                  Promise.resolve({
                    data: statuses.includes("queued") ? [] : recent,
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      };
    },
  } as never;
}

describe("getCiEnforcementStatus matrix", () => {
  beforeEach(() => {
    vi.mocked(getProductionVerdictByScan).mockReset();
  });

  it("returns missing phase and neutral conclusion for unknown SHA", async () => {
    const status = await getCiEnforcementStatus(buildAdmin([]), {
      projectId: PROJECT,
      organizationId: ORG,
      commitSha: COMMIT,
    });

    expect(status.scanPhase).toBe("missing");
    expect(status.checkRun.conclusion).toBe("neutral");
    expect(status.ok).toBe(false);
  });

  it("returns pending/running as neutral (not success)", async () => {
    const admin = buildAdmin([]);
    (admin.from as (t: string) => unknown)("scans");
    const status = await getCiEnforcementStatus(
      {
        from: () => ({
          select: () => ({
            eq: () => ({
              in: (_c: string, statuses: string[]) => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data:
                        statuses.includes("queued")
                          ? [{ id: "s1", status: "scanning", commit_sha: COMMIT }]
                          : [],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        }),
      } as never,
      { projectId: PROJECT, organizationId: ORG, commitSha: COMMIT }
    );

    expect(status.scanPhase).toBe("running");
    expect(status.checkRun.conclusion).toBe("neutral");
    expect(status.ok).toBe(false);
  });

  it("maps insufficient_data to action_required", async () => {
    vi.mocked(getProductionVerdictByScan).mockResolvedValue(mockVerdict("insufficient_data"));
    const status = await getCiEnforcementStatus(
      buildAdmin([{ id: "s1", status: "completed", commit_sha: COMMIT }]),
      { projectId: PROJECT, organizationId: ORG, commitSha: COMMIT }
    );

    expect(status.scanPhase).toBe("completed");
    expect(status.checkRun.conclusion).toBe("action_required");
    expect(status.ok).toBe(true);
  });

  it("maps failed scan to neutral (fail closed, not success)", async () => {
    const status = await getCiEnforcementStatus(
      buildAdmin([{ id: "s1", status: "failed", commit_sha: COMMIT }]),
      { projectId: PROJECT, organizationId: ORG, commitSha: COMMIT }
    );

    expect(status.scanPhase).toBe("failed");
    expect(status.checkRun.conclusion).not.toBe("success");
    expect(status.ok).toBe(false);
  });
});
