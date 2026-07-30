import { describe, expect, it } from "vitest";
import {
  attackHypothesisFromRedTeamFinding,
  buildExecutionPlanForScenario,
  buildPlanHash,
  plannedScenarioInputsFromHypotheses,
} from "@/server/attack-simulation";
import type { AttackCampaign } from "@/server/attack-simulation/contracts/attack-campaign";
import type { AttackScenario } from "@/server/attack-simulation/contracts/attack-scenario";

describe("campaign planning", () => {
  const campaign: AttackCampaign = {
    id: "11111111-1111-4111-8111-111111111111",
    scanId: "44444444-4444-4444-8444-444444444444",
    scanJobId: null,
    projectId: "55555555-5555-4555-8555-555555555555",
    organizationId: "66666666-6666-4666-8666-666666666666",
    commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
    runtimeMode: "mock",
    status: "planned",
    correlationId: "11111111-1111-4111-8111-111111111111",
    authorizationId: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    failureCode: null,
    safeFailureMessage: null,
    totalScenarios: 0,
    totalExecutions: 0,
    completedExecutions: 0,
    confirmedFindings: 0,
    blockedExecutions: 0,
    progressPercent: 0,
    estimatedRemainingMs: null,
    createdAt: "2026-07-30T09:00:00.000Z",
    updatedAt: "2026-07-30T09:00:00.000Z",
  };

  it("returns planned scenario inputs when preconditions pass", () => {
    const result = plannedScenarioInputsFromHypotheses({
      campaign,
      hypotheses: [
        attackHypothesisFromRedTeamFinding({
          id: "h1",
          title: "Workflow bypass in checkout",
          description: "State transition skipped",
          category: "business_logic",
          severity: "high",
          confidence: 0.8,
          source: "logic.business",
        }),
      ],
    });

    expect(result.precondition.ok).toBe(true);
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0].adapter.id).toBe("workflow-bypass");
  });

  it("builds deterministic execution plan hash material", () => {
    const scenario: AttackScenario = {
      id: "22222222-2222-4222-8222-222222222222",
      campaignId: campaign.id,
      organizationId: campaign.organizationId,
      projectId: campaign.projectId,
      hypothesisId: "h1",
      adapterId: "workflow-bypass",
      category: "business_logic",
      title: "Workflow bypass",
      description: "State transition skipped",
      status: "planned",
      sortOrder: 0,
      redTeamSource: "logic.business",
      metadata: { attackerProfile: { role: "buyer" } },
      createdAt: "2026-07-30T09:00:00.000Z",
      updatedAt: "2026-07-30T09:00:00.000Z",
    };

    const bundle = buildExecutionPlanForScenario({ scenario, campaign });
    const hashA = buildPlanHash(bundle.planHashMaterial);
    const hashB = buildPlanHash(bundle.planHashMaterial);
    expect(hashA).toBe(hashB);
    expect(bundle.stepTemplate).toHaveLength(8);
  });
});
