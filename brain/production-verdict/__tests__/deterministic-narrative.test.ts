import { describe, expect, it } from "vitest";
import { buildDeterministicSummary } from "../summary";
import { recommendedAction } from "../status-rules";
import { containsApprovalLanguage } from "../narrative-guard";

const base = {
  status: "ready_to_ship" as const,
  score: 100,
  blockersCount: 0,
  criticalBlockersCount: 0,
  highBlockersCount: 0,
  topPriorities: [],
  evaluatedAreas: [],
  partiallyEvaluatedAreas: [],
  unevaluatedAreas: [],
};

describe("deterministic ready_to_ship narrative", () => {
  it("is not approval wording at medium confidence with unevaluated areas", () => {
    const text = buildDeterministicSummary({
      ...base,
      confidence: "medium",
      unevaluatedAreas: [{}, {}, {}, {}] as never,
    });
    expect(text).not.toMatch(/Ready to Ship|meets the current readiness/);
    expect(text).toMatch(/not a deployment approval/);
    expect(text).toMatch(/4 areas are not fully evaluated/);
    expect(containsApprovalLanguage(text)).toBe(false);
  });
  it("keeps approval wording only for high confidence and full coverage", () => {
    expect(buildDeterministicSummary({ ...base, confidence: "high" })).toMatch(/Ready to Ship/);
  });
  it("recommended action is qualified when evidence does not support approval", () => {
    expect(recommendedAction("ready_to_ship", 0, false)).not.toMatch(/Deploy when/);
    expect(recommendedAction("ready_to_ship", 0, true)).toMatch(/Deploy when/);
  });
});
