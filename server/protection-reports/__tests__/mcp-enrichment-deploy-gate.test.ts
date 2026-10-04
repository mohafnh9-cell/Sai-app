import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getCurrentReport = vi.fn();
vi.mock("../storage", () => ({ getCurrentReport: (...a: unknown[]) => getCurrentReport(...a) }));

import { enrichMcpToolResultWithReports } from "../mcp-enrichment";

const report = {
  narrative: "n",
  founderSummary: {
    moreProtectedNarrative: "Yes — compared to last month, X is in a stronger protection posture.",
    whatWorriesSequrAI: ["Nothing urgent — keep building and ask before you deploy."],
    wouldDeployToday: "If this were my company, I would deploy today.",
  },
};

describe("protection-report teaser on can_i_deploy", () => {
  beforeEach(() => getCurrentReport.mockReset().mockResolvedValue(report));
  const run = (deploymentRecommendation: "SHIP_IT" | "DO_NOT_DEPLOY" | "MORE_ANALYSIS_REQUIRED") =>
    enrichMcpToolResultWithReports({} as never, "can_i_deploy", {
      summary: "base",
      project: { id: "p" },
      deploymentRecommendation,
    });

  it.each(["MORE_ANALYSIS_REQUIRED", "DO_NOT_DEPLOY"] as const)(
    "never appends first-person deploy approval or 'stronger posture' when recommendation is %s",
    async (rec) => {
      const out = await run(rec);
      expect(out.summary).not.toMatch(/I would deploy today|stronger protection posture|Yes —/);
      expect(out.summary).toContain("base");
    }
  );

  it("keeps the retrospective narrative only for SHIP_IT", async () => {
    const out = await run("SHIP_IT");
    expect(out.summary).toMatch(/I would deploy today/);
  });
});
