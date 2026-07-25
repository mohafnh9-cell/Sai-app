import { describe, expect, it } from "vitest";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { formatCanIDeployResponse, pickRecommendedAction } from "@/server/mcp/personality";

const t = getMcpTranslator("en");

describe("MCP personality — can_i_deploy text", () => {
  it("uses opinionated NO lead instead of vulnerability counts", () => {
    const text = formatCanIDeployResponse(t, {
      decision: "do_not_deploy",
      status: "not_ready",
      executiveSummary: "Two production blockers remain.",
      worries: ["Exposed secret in env file", "Missing auth on admin routes"],
      blockersCount: 2,
      staleness: {
        reviewInProgress: false,
        freshnessStatus: "current",
        reviewFailed: false,
        latestDetectedCommitSha: null,
      },
    });

    expect(text).toContain("NO.");
    expect(text).toContain("I would not deploy");
    expect(text).toContain("What worries me most:");
    expect(text).toContain("Exposed secret");
    expect(text).not.toContain("Production blockers:");
    expect(text).not.toContain("Production Ready Score");
    expect(text).not.toContain("72 / 100");
  });

  it("uses YES lead for ready_to_ship", () => {
    const text = formatCanIDeployResponse(t, {
      decision: "deploy",
      status: "ready_to_ship",
      executiveSummary: "",
      worries: [],
      blockersCount: 0,
      staleness: {
        reviewInProgress: false,
        freshnessStatus: "current",
        reviewFailed: false,
        latestDetectedCommitSha: null,
      },
    });

    expect(text).toContain("YES.");
    expect(text).toContain("comfortable with you shipping");
    expect(text).toContain("Nothing critical is blocking");
  });

  it("recommends Safe Fix when blockers exist", () => {
    expect(
      pickRecommendedAction(t, {
        decision: "do_not_deploy",
        status: "not_ready",
        blockersCount: 2,
        staleness: {
          reviewInProgress: false,
          freshnessStatus: "current",
          reviewFailed: false,
          latestDetectedCommitSha: null,
        },
      })
    ).toBe("Apply Safe Fix.");
  });
});
