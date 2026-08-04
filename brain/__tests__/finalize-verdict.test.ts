import { describe, expect, it } from "vitest";
import { finalizeProductionVerdict, mapSecurityDeploymentToVerdictStatus } from "../production-verdict/finalize-verdict";
import type { ProductionVerdictV1 } from "../production-verdict/schema";

function baseVerdict(overrides: Partial<ProductionVerdictV1> = {}): ProductionVerdictV1 {
  return {
    version: "1.0.0",
    projectId: "00000000-0000-4000-8000-000000000001",
    repositoryId: "00000000-0000-4000-8000-000000000001",
    scanId: "00000000-0000-4000-8000-000000000002",
    commitSha: "abc123",
    branch: "main",
    status: "ready_to_ship",
    score: 92,
    previousScore: null,
    scoreDelta: null,
    projectedScore: 95,
    projectedScoreIsEstimate: true,
    blockersCount: 0,
    criticalBlockersCount: 0,
    highBlockersCount: 0,
    estimatedFixMinutes: 0,
    confidence: "high",
    executiveSummary: "Ready.",
    topPriorities: [],
    evaluatedAreas: [],
    partiallyEvaluatedAreas: [],
    unevaluatedAreas: [],
    introducedBlockers: 0,
    resolvedBlockers: 0,
    coverageRatio: 1,
    filesAnalyzed: 40,
    findingsCount: 0,
    recommendedAction: "Deploy.",
    methodologyNote: "Deterministic.",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("finalizeProductionVerdict", () => {
  it("never allows ready_to_ship when blockers remain after security decision", () => {
    const verdict = finalizeProductionVerdict({
      verdict: baseVerdict({ blockersCount: 2, status: "not_ready" }),
      securityDecisionReport: {
        decision: {
          deploymentVerdict: "SAFE_TO_DEPLOY",
          primaryRecommendation: "Ship now.",
          confidence: "high",
          decisionId: "00000000-0000-4000-8000-000000000099",
        },
        explanation: { founder: { headline: "Looks good." } },
      },
    });

    expect(verdict.status).toBe("not_ready");
  });

  it("downgrades to not_ready when attack replay is still vulnerable", () => {
    const verdict = finalizeProductionVerdict({
      verdict: baseVerdict(),
      attackSimulation: {
        campaignId: "00000000-0000-4000-8000-000000000010",
        campaignStatus: "completed",
        totalExecutions: 2,
        confirmedFindings: 1,
        notExploitableFindings: 0,
        protectedExecutions: 1,
        stillVulnerableExecutions: 1,
        blockedExecutions: 0,
        pendingReplay: 0,
        headline: "One attack remains exploitable.",
      },
    });

    expect(verdict.status).toBe("not_ready");
  });

  it("maps deploy with warnings to almost_ready", () => {
    expect(mapSecurityDeploymentToVerdictStatus("DEPLOY_WITH_WARNINGS")).toBe("almost_ready");
  });
});
