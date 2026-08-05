import { describe, expect, it } from "vitest";
import { derivePrimaryActionKind } from "@/server/mission-control/derive-mission-control-ui";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

function minimalVerdict(overrides?: Partial<ProductionVerdictV1>): ProductionVerdictV1 {
  return {
    version: "1.0.0",
    projectId: "p",
    repositoryId: "r",
    scanId: "s",
    commitSha: null,
    status: "not_ready",
    score: 62,
    confidence: "medium",
    headline: "Not ready",
    summary: "Fix issues",
    topPriorities: [
      {
        id: "pr1",
        rank: 1,
        title: "Missing auth",
        category: "auth",
        reason: "Admin route is public",
        severity: "critical",
        confidence: "high",
        estimatedMinutes: 120,
        estimatedTimeLabel: "2 hours",
        projectedScoreImpact: 10,
        affectedFiles: [],
        recommendedAction: "Fix",
        findingIds: [],
      },
    ],
    evaluatedAreas: [],
    generatedAt: new Date().toISOString(),
    methodology: "test",
    limitations: "",
    ...overrides,
  } as ProductionVerdictV1;
}

describe("derivePrimaryActionKind", () => {
  it("returns copy_safe_fix when blockers exist and not ready to ship", () => {
    expect(
      derivePrimaryActionKind({
        verdict: minimalVerdict(),
        securityPhase: "ready",
        reviewInProgress: false,
      })
    ).toBe("copy_safe_fix");
  });

  it("returns run_review_again when ready to ship", () => {
    expect(
      derivePrimaryActionKind({
        verdict: minimalVerdict({ status: "ready_to_ship", topPriorities: [] }),
        securityPhase: "ready",
        reviewInProgress: false,
      })
    ).toBe("run_review_again");
  });

  it("returns run_review_again after protection verified", () => {
    expect(
      derivePrimaryActionKind({
        verdict: minimalVerdict(),
        securityPhase: "protected",
        reviewInProgress: false,
      })
    ).toBe("run_review_again");
  });

  it("returns verify_protection when fix is ready to validate", () => {
    expect(
      derivePrimaryActionKind({
        verdict: minimalVerdict(),
        securityPhase: "fix_ready",
        reviewInProgress: false,
      })
    ).toBe("verify_protection");
  });

  it("returns none while review is in progress", () => {
    expect(
      derivePrimaryActionKind({
        verdict: minimalVerdict(),
        securityPhase: "preparing",
        reviewInProgress: true,
      })
    ).toBe("none");
  });

  it("returns run_review when no verdict yet", () => {
    expect(
      derivePrimaryActionKind({
        verdict: null,
        securityPhase: "needs_review",
        reviewInProgress: false,
      })
    ).toBe("run_review");
  });
});
