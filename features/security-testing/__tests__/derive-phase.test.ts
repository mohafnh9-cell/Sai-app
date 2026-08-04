import { describe, expect, it } from "vitest";
import { deriveSecurityTestPhase } from "../lib/derive-phase";
import type { AttackExecutionStatus } from "@/server/attack-simulation/contracts/enums";

describe("deriveSecurityTestPhase", () => {
  it("returns preparing when review is in progress", () => {
    expect(
      deriveSecurityTestPhase({
        reviewInProgress: true,
        hasLatestScan: true,
        campaignStatus: null,
        executionStatuses: [],
      })
    ).toBe("preparing");
  });

  it("returns needs_review without a completed scan", () => {
    expect(
      deriveSecurityTestPhase({
        reviewInProgress: false,
        hasLatestScan: false,
        campaignStatus: null,
        executionStatuses: [],
      })
    ).toBe("needs_review");
  });

  it("returns ready when scan exists but no campaign", () => {
    expect(
      deriveSecurityTestPhase({
        reviewInProgress: false,
        hasLatestScan: true,
        campaignStatus: null,
        executionStatuses: [],
      })
    ).toBe("ready");
  });

  it("returns fix_ready from execution status", () => {
    expect(
      deriveSecurityTestPhase({
        reviewInProgress: false,
        hasLatestScan: true,
        campaignStatus: "running",
        executionStatuses: ["fix_ready" as AttackExecutionStatus],
      })
    ).toBe("fix_ready");
  });

  it("returns issues_found when one execution is still vulnerable despite another protected", () => {
    expect(
      deriveSecurityTestPhase({
        reviewInProgress: false,
        hasLatestScan: true,
        campaignStatus: "completed",
        executionStatuses: ["protected", "still_vulnerable"] as AttackExecutionStatus[],
      })
    ).toBe("issues_found");
  });

  it("returns issues_found when one execution is confirmed despite another protected", () => {
    expect(
      deriveSecurityTestPhase({
        reviewInProgress: false,
        hasLatestScan: true,
        campaignStatus: "running",
        executionStatuses: ["confirmed", "protected"] as AttackExecutionStatus[],
      })
    ).toBe("issues_found");
  });

  it("returns protected when every execution reached a safe terminal state", () => {
    expect(
      deriveSecurityTestPhase({
        reviewInProgress: false,
        hasLatestScan: true,
        campaignStatus: "completed",
        executionStatuses: ["protected", "not_exploitable"] as AttackExecutionStatus[],
      })
    ).toBe("protected");
  });

  it("returns issues_found for confirmed executions", () => {
    expect(
      deriveSecurityTestPhase({
        reviewInProgress: false,
        hasLatestScan: true,
        campaignStatus: "running",
        executionStatuses: ["confirmed" as AttackExecutionStatus],
      })
    ).toBe("issues_found");
  });

  it("returns running while campaign is active", () => {
    expect(
      deriveSecurityTestPhase({
        reviewInProgress: false,
        hasLatestScan: true,
        campaignStatus: "running",
        executionStatuses: ["executing" as AttackExecutionStatus],
      })
    ).toBe("running");
  });

  it("returns completed_clean when campaign finished with no open issues", () => {
    expect(
      deriveSecurityTestPhase({
        reviewInProgress: false,
        hasLatestScan: true,
        campaignStatus: "completed",
        executionStatuses: ["not_exploitable" as AttackExecutionStatus],
      })
    ).toBe("completed_clean");
  });
});
