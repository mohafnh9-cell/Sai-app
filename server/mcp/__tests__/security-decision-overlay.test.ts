import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { ProductionVerdictV1, VerdictStatus } from "@/brain/production-verdict/schema";
import { applyLatestSecurityDecisionToVerdict } from "../security-decision-overlay";

function baseVerdict(overrides: Partial<ProductionVerdictV1> = {}): ProductionVerdictV1 {
  const projectId = randomUUID();
  return {
    version: "1.0.0",
    projectId,
    repositoryId: randomUUID(),
    scanId: randomUUID(),
    commitSha: "abc123def",
    branch: "main",
    status: "ready_to_ship",
    score: 95,
    previousScore: null,
    scoreDelta: null,
    projectedScore: 95,
    projectedScoreIsEstimate: false,
    blockersCount: 0,
    criticalBlockersCount: 0,
    highBlockersCount: 0,
    estimatedFixMinutes: 0,
    confidence: "high",
    executiveSummary: "Looks good",
    topPriorities: [],
    evaluatedAreas: [],
    partiallyEvaluatedAreas: [],
    unevaluatedAreas: [],
    introducedBlockers: 0,
    resolvedBlockers: 0,
    coverageRatio: 1,
    filesAnalyzed: 1,
    findingsCount: 0,
    recommendedAction: "ship",
    methodologyNote: "test",
    generatedAt: new Date().toISOString(),
    ...overrides,
  } as ProductionVerdictV1;
}

describe("security decision MCP overlay", () => {
  it("reads persisted security decision fields from the verdict", () => {
    const projectId = randomUUID();
    const commitSha = "abc123def";

    const overlay = applyLatestSecurityDecisionToVerdict(projectId, {
      version: "1.0.0",
      projectId,
      repositoryId: randomUUID(),
      scanId: randomUUID(),
      commitSha,
      branch: "main",
      status: "not_ready",
      score: 95,
      previousScore: null,
      scoreDelta: null,
      projectedScore: 95,
      projectedScoreIsEstimate: false,
      blockersCount: 0,
      criticalBlockersCount: 0,
      highBlockersCount: 0,
      estimatedFixMinutes: 0,
      confidence: "high",
      executiveSummary: "Blocked",
      topPriorities: [],
      evaluatedAreas: [],
      partiallyEvaluatedAreas: [],
      unevaluatedAreas: [],
      introducedBlockers: 0,
      resolvedBlockers: 0,
      coverageRatio: 1,
      filesAnalyzed: 1,
      findingsCount: 0,
      recommendedAction: "Block",
      methodologyNote: "test",
      generatedAt: new Date().toISOString(),
      securityDeploymentVerdict: "DO_NOT_DEPLOY",
      securityDecisionId: randomUUID(),
    });

    expect(overlay.applied).toBe(true);
    expect(overlay.deploymentRecommendation).toBe("DO_NOT_DEPLOY");
    expect(overlay.verdict.status).toBe("not_ready");
  });

  it("does not recompute when no persisted security decision exists", () => {
    const overlay = applyLatestSecurityDecisionToVerdict(randomUUID(), {
      version: "1.0.0",
      projectId: randomUUID(),
      repositoryId: randomUUID(),
      scanId: randomUUID(),
      commitSha: "abc",
      branch: "main",
      status: "ready_to_ship",
      score: 95,
      previousScore: null,
      scoreDelta: null,
      projectedScore: 95,
      projectedScoreIsEstimate: false,
      blockersCount: 0,
      criticalBlockersCount: 0,
      highBlockersCount: 0,
      estimatedFixMinutes: 0,
      confidence: "high",
      executiveSummary: "Looks good",
      topPriorities: [],
      evaluatedAreas: [],
      partiallyEvaluatedAreas: [],
      unevaluatedAreas: [],
      introducedBlockers: 0,
      resolvedBlockers: 0,
      coverageRatio: 1,
      filesAnalyzed: 1,
      findingsCount: 0,
      recommendedAction: "ship",
      methodologyNote: "test",
      generatedAt: new Date().toISOString(),
    });

    expect(overlay.applied).toBe(false);
    expect(overlay.verdict.status).toBe("ready_to_ship");
  });

  // SECURITY INVARIANT regression: an insufficient-coverage verdict must
  // never have its deployment recommendation promoted by this overlay,
  // no matter what the security decision report itself concluded.
  describe("SECURITY: insufficient coverage always wins over the security decision report", () => {
    const insufficientStatuses: VerdictStatus[] = ["insufficient_data", "analysis_failed"];

    for (const status of insufficientStatuses) {
      // A / F: 8/12 coverage (or any insufficient status) + score 100 +
      // zero findings + a security report that concluded "safe" must
      // still never produce SHIP_IT/"Safe to deploy".
      it(`does NOT apply the overlay when verdict.status is "${status}", even with score 100, zero findings, and SAFE_TO_DEPLOY security decision`, () => {
        const overlay = applyLatestSecurityDecisionToVerdict(
          randomUUID(),
          baseVerdict({
            status,
            score: 100,
            findingsCount: 0,
            coverageRatio: 8 / 12,
            securityDeploymentVerdict: "SAFE_TO_DEPLOY",
            securityDecisionId: randomUUID(),
          })
        );

        expect(overlay.applied).toBe(false);
        expect(overlay.deploymentRecommendation).toBeNull();
        expect(overlay.executiveSummarySuffix).toBeNull();
        // G: the verdict's own status -- what downstream summary/decision
        // logic reads -- is left completely untouched by the overlay.
        expect(overlay.verdict.status).toBe(status);
      });

      it(`does NOT apply even when the security decision is DEPLOY_WITH_WARNINGS for status "${status}"`, () => {
        const overlay = applyLatestSecurityDecisionToVerdict(
          randomUUID(),
          baseVerdict({
            status,
            securityDeploymentVerdict: "DEPLOY_WITH_WARNINGS",
            securityDecisionId: randomUUID(),
          })
        );

        expect(overlay.applied).toBe(false);
        expect(overlay.deploymentRecommendation).toBeNull();
      });
    }

    // The invariant is one-directional: insufficient coverage suppresses
    // a promotion to SHIP_IT, but a security decision that itself says
    // DO_NOT_DEPLOY for an insufficient-coverage verdict is not a
    // promotion -- both the verdict and the security report already agree
    // the app isn't shippable. This still stays suppressed under the
    // simple, unconditional rule (insufficient coverage is never
    // overridable at all here), which is intentional: the MORE_ANALYSIS_REQUIRED
    // mapping the caller falls back to for insufficient_data already
    // conveys "not shippable" without needing the overlay's help.
    it("suppresses the overlay uniformly even when the security decision itself says DO_NOT_DEPLOY", () => {
      const overlay = applyLatestSecurityDecisionToVerdict(
        randomUUID(),
        baseVerdict({
          status: "insufficient_data",
          securityDeploymentVerdict: "DO_NOT_DEPLOY",
          securityDecisionId: randomUUID(),
        })
      );

      expect(overlay.applied).toBe(false);
    });
  });

  // B / I: a legitimate, sufficiently-evaluated ready_to_ship verdict with
  // a security decision must still apply normally -- the fix must not
  // over-suppress real, valid cases.
  it("still applies normally for a sufficiently-evaluated ready_to_ship verdict (existing behavior preserved)", () => {
    const overlay = applyLatestSecurityDecisionToVerdict(
      randomUUID(),
      baseVerdict({
        status: "ready_to_ship",
        score: 100,
        findingsCount: 0,
        coverageRatio: 1,
        securityDeploymentVerdict: "SAFE_TO_DEPLOY",
        securityDecisionId: randomUUID(),
      })
    );

    expect(overlay.applied).toBe(true);
    expect(overlay.deploymentRecommendation).toBe("SHIP_IT");
  });

  // J: existing not_ready/blockers behavior (already covered by the first
  // test in this file) is unaffected -- confirmed again here explicitly
  // against the shared baseVerdict fixture for parity with the new cases.
  it("still applies normally for a not_ready verdict with a DO_NOT_DEPLOY security decision (existing behavior preserved)", () => {
    const overlay = applyLatestSecurityDecisionToVerdict(
      randomUUID(),
      baseVerdict({
        status: "not_ready",
        securityDeploymentVerdict: "DO_NOT_DEPLOY",
        securityDecisionId: randomUUID(),
      })
    );

    expect(overlay.applied).toBe(true);
    expect(overlay.deploymentRecommendation).toBe("DO_NOT_DEPLOY");
  });
});
