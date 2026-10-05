import { describe, expect, it } from "vitest";
import { evaluateProtectionStatus } from "@/server/continuous-protection/status-machine";
import { computeProductionHealthScore } from "@/server/continuous-protection/health-models";
import type { StatusEvaluationInput } from "@/server/continuous-protection/types";
import type { ProtectionDecision } from "@/brain/production-verdict/protection-decision";

const verdictDecision = (posture: "ready" | "ready_evidence_limited" | "more_analysis_required" | "not_ready"): ProtectionDecision => ({
  state: "verdict",
  posture,
  verdictStatus: posture === "ready" || posture === "ready_evidence_limited" ? "ready_to_ship" : posture === "not_ready" ? "not_ready" : "insufficient_data",
  confidence: posture === "ready" ? "high" : "low",
  scanId: "scan-1",
  commitSha: "abc1234",
});
const readyDecision = verdictDecision("ready");

function baseInput(overrides: Partial<StatusEvaluationInput> = {}): StatusEvaluationInput {
  return {
    continuousProtectionEnabled: true,
    continuousProtectionPaused: false,
    githubConnected: true,
    hasSuccessfulReview: true,
    lastCheckAt: new Date().toISOString(),
    consecutiveDailyFailures: 0,
    decision: readyDecision,
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

  it("returns PROTECTED only when the canonical verdict posture is ready", () => {
    expect(evaluateProtectionStatus(baseInput())).toBe("PROTECTED");
  });

  it("never judges safety on its own: every non-ready canonical posture needs attention, never SAFE_WITH_CAUTION or PROTECTED (G)", () => {
    for (const posture of ["ready_evidence_limited", "more_analysis_required", "not_ready"] as const) {
      const status = evaluateProtectionStatus(baseInput({ decision: verdictDecision(posture) }));
      expect(status).toBe("REQUIRES_ATTENTION");
      expect(status).not.toBe("SAFE_WITH_CAUTION");
      expect(status).not.toBe("PROTECTED");
    }
  });

  it("without a completed current verdict there is no decision: never PROTECTED / SAFE_WITH_CAUTION / REQUIRES_ATTENTION-as-a-verdict (A, B)", () => {
    for (const decision of [{ state: "no_verdict" }, { state: "analysis_in_progress" }] as ProtectionDecision[]) {
      expect(evaluateProtectionStatus(baseInput({ decision }))).toBe("NOT_PROTECTED");
    }
  });

  it("the old second decision system is gone: high open issues + low confidence cannot yield SAFE_WITH_CAUTION", () => {
    expect(evaluateProtectionStatus(baseInput({ decision: verdictDecision("not_ready") }))).not.toBe("SAFE_WITH_CAUTION");
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
