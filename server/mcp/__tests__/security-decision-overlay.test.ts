import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { applyLatestSecurityDecisionToVerdict } from "../security-decision-overlay";
import { globalProjectDecisionStore } from "@/server/ai-red-team/decision/project-decision-store";
import type { SecurityDecisionReport } from "@/server/ai-red-team/decision/decision-model";

describe("security decision MCP overlay", () => {
  it("overrides deployment recommendation when snapshot matches commit", () => {
    const projectId = randomUUID();
    const commitSha = "abc123def";
    const report = {
      decision: {
        decisionId: randomUUID(),
        decision: "BLOCK_DEPLOYMENT",
        deploymentVerdict: "DO_NOT_DEPLOY",
        summary: "blocked",
        technicalReasoning: "t",
        businessReasoning: "b",
        evidenceUsed: [],
        evidenceMissing: [],
        confidence: "high",
        requiredActions: [],
        primaryRecommendation: "Block",
        policiesTriggered: ["gate.confirmed_deploy_blocker"],
        policyVersion: "rt5-v1",
        generatedAt: new Date().toISOString(),
      },
      explanation: {
        founder: { headline: "No", body: [] },
        engineer: {
          policiesTriggered: [],
          coverageSummary: "",
          attackChains: [],
          rootCauses: [],
          confidence: "high",
          evidenceUsed: [],
          evidenceMissing: [],
        },
      },
      coverageScore: 0.4,
      coverageGaps: [],
      historyEntry: null,
    } satisfies SecurityDecisionReport;

    globalProjectDecisionStore.set({
      projectId,
      commitSha,
      report,
      recordedAt: new Date().toISOString(),
    });

    const overlay = applyLatestSecurityDecisionToVerdict(projectId, {
      version: "1.0.0",
      projectId,
      repositoryId: randomUUID(),
      scanId: randomUUID(),
      commitSha,
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

    expect(overlay.applied).toBe(true);
    expect(overlay.deploymentRecommendation).toBe("DO_NOT_DEPLOY");
    expect(overlay.verdict.status).toBe("not_ready");
  });
});
