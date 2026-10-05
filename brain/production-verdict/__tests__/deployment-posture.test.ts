import { describe, expect, it } from "vitest";
import { deploymentPostureOf, verdictAffirmsDeploy, type DeploymentEvidence } from "../deployment-posture";

const area = (key: string) => ({ key, label: key, score: null, status: "not_evaluated", confidence: "low", limitations: "", methodology: "", evidenceCount: 0 });

function evidence(over: Partial<DeploymentEvidence> = {}): DeploymentEvidence {
  return { status: "ready_to_ship", confidence: "high", unevaluatedAreas: [], partiallyEvaluatedAreas: [], ...over } as DeploymentEvidence;
}

describe("deploymentPostureOf / verdictAffirmsDeploy (the single UI gate)", () => {
  it("1. READY + high confidence + complete coverage -> affirmative allowed", () => {
    expect(deploymentPostureOf(evidence())).toBe("ready");
    expect(verdictAffirmsDeploy(evidence())).toBe(true);
  });
  it("2. READY + low confidence -> forbidden", () => {
    expect(verdictAffirmsDeploy(evidence({ confidence: "low" }))).toBe(false);
    expect(deploymentPostureOf(evidence({ confidence: "low" }))).toBe("ready_evidence_limited");
  });
  it("2b. READY + medium confidence -> forbidden", () => {
    expect(verdictAffirmsDeploy(evidence({ confidence: "medium" }))).toBe(false);
  });
  it("3. READY + unevaluated or partial areas -> forbidden", () => {
    expect(verdictAffirmsDeploy(evidence({ unevaluatedAreas: [area("testing")] as never }))).toBe(false);
    expect(verdictAffirmsDeploy(evidence({ partiallyEvaluatedAreas: [area("auth")] as never }))).toBe(false);
  });
  it("4./5. score 100 or zero blockers do not matter: only confidence + coverage (the evidence) do", () => {
    // The helper deliberately does not even read score or blockers.
    expect(verdictAffirmsDeploy({ ...evidence({ confidence: "low" }), score: 100, blockersCount: 0 } as never)).toBe(false);
  });
  it("6. NOT_READY / almost_ready / needs_improvement -> not affirmative, posture not_ready", () => {
    for (const status of ["not_ready", "almost_ready", "needs_improvement"] as const) {
      expect(verdictAffirmsDeploy(evidence({ status }))).toBe(false);
      expect(deploymentPostureOf(evidence({ status }))).toBe("not_ready");
    }
  });
  it("7./8. INSUFFICIENT_DATA / analysis_failed (MORE_ANALYSIS_REQUIRED) -> not affirmative", () => {
    for (const status of ["insufficient_data", "analysis_failed"] as const) {
      expect(verdictAffirmsDeploy(evidence({ status }))).toBe(false);
      expect(deploymentPostureOf(evidence({ status }))).toBe("more_analysis_required");
    }
  });
  it("no verdict is never affirmative", () => {
    expect(verdictAffirmsDeploy(null)).toBe(false);
    expect(verdictAffirmsDeploy(undefined)).toBe(false);
  });
});
