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

  // SECURITY regression (CRIT-001, deeper contamination found during
  // production verification): a persisted verdict's own executiveSummary
  // can be overwritten at verdict-generation time by a secondary security
  // decision subsystem's "safe to deploy" narrative even when the
  // verdict's own status is insufficient_data. That text must never
  // surface here -- it would directly contradict the conservative
  // "I can't answer responsibly yet" framing this branch always leads with.
  it("SECURITY: never surfaces a contaminated executiveSummary claiming deployment safety for insufficient_data", () => {
    const text = formatCanIDeployResponse(t, {
      decision: "more_analysis_required",
      status: "insufficient_data",
      executiveSummary: "Safe to deploy based on current authorized security evidence.",
      worries: [],
      blockersCount: 0,
      staleness: {
        reviewInProgress: false,
        freshnessStatus: "current",
        reviewFailed: false,
        latestDetectedCommitSha: null,
      },
    });

    expect(text).not.toContain("Safe to deploy");
    expect(text).not.toContain("based on current authorized security evidence");
    expect(text).toContain("I don't have enough of your repository reviewed yet to protect you responsibly.");
  });

  it("still uses the safe canonical insufficient_data message even when executiveSummary is empty (existing fallback preserved)", () => {
    const text = formatCanIDeployResponse(t, {
      decision: "more_analysis_required",
      status: "insufficient_data",
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

    expect(text).toContain("I don't have enough of your repository reviewed yet to protect you responsibly.");
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
