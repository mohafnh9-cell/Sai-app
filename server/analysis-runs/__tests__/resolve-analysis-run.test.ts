import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveAnalysisRunForMissionControl } from "../resolve-analysis-run";

vi.mock("@/server/review-cancel/get-production-review-state", () => ({
  getProductionReviewState: vi.fn(),
}));

vi.mock("../get-analysis-run-snapshot", () => ({
  isAnalysisRunOwnedByProject: vi.fn(),
}));

import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { isAnalysisRunOwnedByProject } from "../get-analysis-run-snapshot";

const PROJECT = "proj-1";
const ORG = "org-1";
const RUN = "run-abc";

function buildAdmin(scanRows: Array<{ id: string; status?: string }>) {
  let callIndex = 0;
  return {
    from: (table: string) => {
      if (table !== "scans") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      const row = scanRows[callIndex++];
                      return row ? { data: row, error: null } : { data: null, error: null };
                    },
                  }),
                }),
              }),
              in: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      const row = scanRows[callIndex++];
                      return row ? { data: row, error: null } : { data: null, error: null };
                    },
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    },
  } as never;
}

describe("resolveAnalysisRunForMissionControl", () => {
  beforeEach(() => {
    vi.mocked(getProductionReviewState).mockReset();
    vi.mocked(isAnalysisRunOwnedByProject).mockReset();
  });

  it("returns requested run when owned", async () => {
    vi.mocked(isAnalysisRunOwnedByProject).mockResolvedValue(true);

    const result = await resolveAnalysisRunForMissionControl({} as never, {
      projectId: PROJECT,
      organizationId: ORG,
      requestedRunId: RUN,
    });

    expect(result).toEqual({ runId: RUN, source: "query", valid: true });
  });

  it("marks invalid when requested run is not owned", async () => {
    vi.mocked(isAnalysisRunOwnedByProject).mockResolvedValue(false);

    const result = await resolveAnalysisRunForMissionControl({} as never, {
      projectId: PROJECT,
      organizationId: ORG,
      requestedRunId: RUN,
    });

    expect(result).toEqual({ runId: null, source: "none", valid: false });
  });

  it("prefers active review scan when no query param", async () => {
    vi.mocked(getProductionReviewState).mockResolvedValue({
      scanId: "active-scan",
      hasActiveReview: true,
      status: "running",
    } as never);

    const result = await resolveAnalysisRunForMissionControl({} as never, {
      projectId: PROJECT,
      organizationId: ORG,
    });

    expect(result).toEqual({ runId: "active-scan", source: "active", valid: true });
  });

  it("falls back to latest completed scan", async () => {
    vi.mocked(getProductionReviewState).mockResolvedValue({
      scanId: null,
      hasActiveReview: false,
      status: "idle",
    } as never);

    const admin = buildAdmin([{ id: "completed-scan" }]);

    const result = await resolveAnalysisRunForMissionControl(admin, {
      projectId: PROJECT,
      organizationId: ORG,
    });

    expect(result).toEqual({ runId: "completed-scan", source: "latest_completed", valid: true });
  });

  it("falls back to latest active scan when no completed", async () => {
    vi.mocked(getProductionReviewState).mockResolvedValue({
      scanId: null,
      hasActiveReview: false,
      status: "idle",
    } as never);

    let completedQuery = true;
    const admin = {
      from: (table: string) => {
        if (table !== "scans") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => {
                        if (completedQuery) {
                          completedQuery = false;
                          return { data: null, error: null };
                        }
                        return { data: { id: "queued-scan" }, error: null };
                      },
                    }),
                  }),
                }),
                in: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: { id: "queued-scan" }, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      },
    } as never;

    const result = await resolveAnalysisRunForMissionControl(admin, {
      projectId: PROJECT,
      organizationId: ORG,
    });

    expect(result).toEqual({ runId: "queued-scan", source: "active", valid: true });
  });

  it("returns none when no scans exist", async () => {
    vi.mocked(getProductionReviewState).mockResolvedValue({
      scanId: null,
      hasActiveReview: false,
      status: "idle",
    } as never);

    const admin = buildAdmin([]);

    const result = await resolveAnalysisRunForMissionControl(admin, {
      projectId: PROJECT,
      organizationId: ORG,
    });

    expect(result).toEqual({ runId: null, source: "none", valid: true });
  });
});
