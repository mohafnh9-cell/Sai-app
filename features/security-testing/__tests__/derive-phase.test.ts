import { describe, expect, it } from "vitest";
import { deriveSecurityTestPhase } from "../derive-phase";
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

  it("returns protected when any execution is protected", () => {
    expect(
      deriveSecurityTestPhase({
        reviewInProgress: false,
        hasLatestScan: true,
        campaignStatus: "running",
        executionStatuses: ["confirmed", "protected"] as AttackExecutionStatus[],
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
});
