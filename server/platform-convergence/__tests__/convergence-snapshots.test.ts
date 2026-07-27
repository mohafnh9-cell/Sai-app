import { describe, expect, it } from "vitest";
import { buildScanJobPlatformMetadata, flattenPlatformMetadataForScanJob } from "../build-scan-metadata";
import { buildPlatformExecutionIds } from "../types";
import type { RedTeamReport } from "@/server/ai-red-team/types";
import { PLATFORM_E2E_INTERNAL_ORG } from "@/server/ai-red-team/e2e-validation/scenarios";
import { createDefaultRedTeamEngine } from "@/server/ai-red-team";
import { productionVerdictFingerprint } from "@/server/ai-red-team/e2e-validation/scenarios";
import { applySecurityDecisionToProductionVerdict } from "@/server/ai-red-team/decision/production-verdict-bridge";

const HYBRID_REPO = {
  projectId: "00000000-0000-4000-8000-000000000099",
  organizationId: PLATFORM_E2E_INTERNAL_ORG,
  commitSha: "e2e00000000000000000000000000000000000007",
  files: [
    {
      path: "package.json",
      content: JSON.stringify({
        dependencies: { stripe: "14.0.0", openai: "4.0.0", ai: "4.0.0" },
      }),
    },
    { path: "app/api/chat/route.ts", content: "export async function POST() {}" },
    { path: "app/api/checkout/route.ts", content: "export async function POST() {}" },
  ],
};

describe("platform convergence snapshots", () => {
  it("matches scan metadata snapshot shape", async () => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = PLATFORM_E2E_INTERNAL_ORG;
    process.env.SEQURAI_LLM_TEAM_MODE = "full";
    const scanId = "00000000-0000-4000-8000-000000000001";
    const scanJobId = "00000000-0000-4000-8000-000000000002";
    const { director } = createDefaultRedTeamEngine();
    const report = await director.run({
      requestId: scanId,
      directorPipeline: true,
      context: {
        projectId: HYBRID_REPO.projectId,
        organizationId: HYBRID_REPO.organizationId,
        metadata: { scanId, scanJobId, correlationId: scanId, executionId: scanJobId },
      },
      discoveryRepository: HYBRID_REPO,
    });

    const platform = buildScanJobPlatformMetadata(
      {
        status: "completed",
        ids: buildPlatformExecutionIds({ scanId, scanJobId, decisionId: report.securityDecision?.decision.decisionId }),
        report,
        securityDecision: report.securityDecision ?? null,
        errorMessage: null,
        durationMs: 1,
      },
      report
    );
    const flat = flattenPlatformMetadataForScanJob(platform);
    expect(flat).toMatchSnapshot("scan-job-metadata-keys");
    expect(platform.version).toBe("1.0.0");
    expect(platform.ids.correlationId).toBe(scanId);
    expect(platform.ids.executionId).toBe(scanJobId);
  });

  it("matches production verdict merge snapshot", async () => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = PLATFORM_E2E_INTERNAL_ORG;
    const { director } = createDefaultRedTeamEngine();
    const report = await director.run({
      requestId: "00000000-0000-4000-8000-000000000003",
      directorPipeline: true,
      context: {
        projectId: HYBRID_REPO.projectId,
        organizationId: HYBRID_REPO.organizationId,
      },
      discoveryRepository: HYBRID_REPO,
    });
    expect(report.securityDecision).toBeDefined();
    const baseVerdict = {
      version: "1.0.0",
      projectId: HYBRID_REPO.projectId,
      repositoryId: HYBRID_REPO.projectId,
      scanId: "00000000-0000-4000-8000-000000000003",
      commitSha: HYBRID_REPO.commitSha,
      branch: "main",
      status: "needs_improvement" as const,
      score: 70,
      previousScore: null,
      scoreDelta: null,
      projectedScore: 85,
      projectedScoreIsEstimate: true,
      blockersCount: 1,
      criticalBlockersCount: 0,
      highBlockersCount: 1,
      estimatedFixMinutes: 60,
      confidence: "medium" as const,
      executiveSummary: "Scanner summary",
      topPriorities: [],
      evaluatedAreas: [],
      partiallyEvaluatedAreas: [],
      unevaluatedAreas: [],
      introducedBlockers: 0,
      resolvedBlockers: 0,
      coverageRatio: 0.8,
      filesAnalyzed: 3,
      findingsCount: 1,
      recommendedAction: "Fix issues",
      methodologyNote: "test",
      generatedAt: new Date(0).toISOString(),
    };
    const merged = applySecurityDecisionToProductionVerdict(baseVerdict, report.securityDecision!);
    expect({
      status: merged.status,
      securityDeploymentVerdict: merged.securityDeploymentVerdict,
      securityDecisionId: merged.securityDecisionId,
      executiveSummary: merged.executiveSummary,
    }).toMatchSnapshot("verdict-decision-merge");
    expect(productionVerdictFingerprint(report)).toMatchSnapshot("director-verdict-fingerprint");
  });
});
