import { describe, expect, it } from "vitest";
import { listAnalysisRunsForProject } from "../list-analysis-runs";

describe("listAnalysisRunsForProject", () => {
  it("returns runs newest-first with verdict status", async () => {
    const admin = {
      from: (table: string) => {
        if (table === "scans") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [
                        {
                          id: "run-new",
                          status: "completed",
                          commit_sha: "abc1234567890",
                          branch: "main",
                          created_at: "2026-02-02T00:00:00Z",
                          completed_at: "2026-02-02T00:05:00Z",
                          security_score: 88,
                        },
                        {
                          id: "run-old",
                          status: "completed",
                          commit_sha: "def1234567890",
                          branch: "main",
                          created_at: "2026-02-01T00:00:00Z",
                          completed_at: "2026-02-01T00:05:00Z",
                          security_score: 72,
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "production_verdicts") {
          return {
            select: () => ({
              in: async () => ({
                data: [
                  { scan_id: "run-new", status: "almost_ready" },
                  { scan_id: "run-old", status: "needs_improvement" },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;

    const runs = await listAnalysisRunsForProject(admin, {
      projectId: "proj-1",
      organizationId: "org-1",
    });

    expect(runs).toHaveLength(2);
    expect(runs[0]?.runId).toBe("run-new");
    expect(runs[0]?.verdictStatus).toBe("almost_ready");
    expect(runs[1]?.runId).toBe("run-old");
  });
});
