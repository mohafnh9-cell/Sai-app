import { describe, expect, it } from "vitest";
import { evaluateProtectionStatus } from "@/server/continuous-protection/status-machine";
import { computeProductionHealthScore } from "@/server/continuous-protection/health-models";
import type { StatusEvaluationInput } from "@/server/continuous-protection/types";

function baseInput(overrides: Partial<StatusEvaluationInput> = {}): StatusEvaluationInput {
  return {
    continuousProtectionEnabled: true,
    continuousProtectionPaused: false,
    githubConnected: true,
    hasSuccessfulReview: true,
    lastCheckAt: new Date().toISOString(),
    consecutiveDailyFailures: 0,
    deployAnswer: "go",
    openCriticalCount: 0,
    openHighCount: 0,
    productionConfidence: 92,
    securityConfidence: 90,
    productionConfidenceDelta7d: 0,
    securityConfidenceDelta7d: 0,
    materialChangeIn7d: false,
    attackSurfaceIncreased: false,
    newCriticalDependencyAdvisory: false,
    staleCheckWhileCpOn: false,
    ...overrides,
  };
}

describe("protection status machine", () => {
  it("returns NOT_PROTECTED when CP is paused", () => {
    expect(
      evaluateProtectionStatus(baseInput({ continuousProtectionPaused: true }))
    ).toBe("NOT_PROTECTED");
  });

  it("returns NOT_PROTECTED without GitHub", () => {
    expect(evaluateProtectionStatus(baseInput({ githubConnected: false }))).toBe("NOT_PROTECTED");
  });

  it("returns REQUIRES_ATTENTION on stale check", () => {
    expect(evaluateProtectionStatus(baseInput({ staleCheckWhileCpOn: true }))).toBe(
      "REQUIRES_ATTENTION"
    );
  });

  it("returns SAFE_WITH_CAUTION with high open issues", () => {
    expect(evaluateProtectionStatus(baseInput({ openHighCount: 2, deployAnswer: "not_yet" }))).toBe(
      "SAFE_WITH_CAUTION"
    );
  });

  it("returns PROTECTED on clean input", () => {
    expect(evaluateProtectionStatus(baseInput())).toBe("PROTECTED");
  });
});

describe("production health score", () => {
  it("computes a bounded score from confidence inputs", () => {
    const score = computeProductionHealthScore({
      productionConfidence: 80,
      securityConfidence: 80,
      lastCheckAt: new Date().toISOString(),
      openCriticalHighCount: 0,
      protectionStatus: "PROTECTED",
    });
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(50);
    expect(score!).toBeLessThanOrEqual(100);
  });
});
