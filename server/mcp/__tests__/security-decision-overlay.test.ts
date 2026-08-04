import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { applyLatestSecurityDecisionToVerdict } from "../security-decision-overlay";

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
});
