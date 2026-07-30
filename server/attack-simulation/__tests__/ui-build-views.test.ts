import { describe, expect, it } from "vitest";
import {
  buildAttackCenterCampaignView,
  buildAttackCenterExecutionView,
  buildAttackCenterFindingView,
} from "@/server/attack-simulation/ui/build-views";
import type { AttackCampaign } from "@/server/attack-simulation/contracts/attack-campaign";
import type { AttackExecution } from "@/server/attack-simulation/contracts/attack-execution";
import type { AttackExecutionStep } from "@/server/attack-simulation/contracts/attack-execution-step";
import type { AttackFinding } from "@/server/attack-simulation/contracts/attack-finding";
import type { AttackRuntimeEvent } from "@/server/attack-simulation/contracts/attack-runtime-event";
import type { AttackScenario } from "@/server/attack-simulation/contracts/attack-scenario";

const campaign: AttackCampaign = {
  id: "11111111-1111-4111-8111-111111111111",
  scanId: "44444444-4444-4444-8444-444444444444",
  scanJobId: null,
  projectId: "55555555-5555-4555-8555-555555555555",
  organizationId: "66666666-6666-4666-8666-666666666666",
  commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
  runtimeMode: "mock",
  status: "running",
  correlationId: "11111111-1111-4111-8111-111111111111",
  authorizationId: null,
  startedAt: "2026-07-30T09:00:00.000Z",
  completedAt: null,
  cancelledAt: null,
  failureCode: null,
  safeFailureMessage: null,
  totalScenarios: 1,
  totalExecutions: 1,
  completedExecutions: 0,
  confirmedFindings: 0,
  blockedExecutions: 0,
  progressPercent: 25,
  estimatedRemainingMs: 120000,
  createdAt: "2026-07-30T09:00:00.000Z",
  updatedAt: "2026-07-30T09:00:00.000Z",
};

describe("attack center view builders", () => {
  it("builds campaign view with execution summaries and feed labels", () => {
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
      status: "running",
      sortOrder: 0,
      redTeamSource: "logic.business",
      metadata: {},
      createdAt: "2026-07-30T09:00:00.000Z",
      updatedAt: "2026-07-30T09:00:00.000Z",
    };

    const execution: AttackExecution = {
      id: "33333333-3333-4333-8333-333333333333",
      campaignId: campaign.id,
      scenarioId: scenario.id,
      scanId: campaign.scanId,
      scanJobId: null,
      projectId: campaign.projectId,
      organizationId: campaign.organizationId,
      commitSha: campaign.commitSha,
      runtimeMode: campaign.runtimeMode,
      correlationId: campaign.correlationId,
      attackerProfile: {},
      protectedAssets: [],
      status: "executing",
      currentStage: "executing",
      currentStepId: null,
      currentStepTitle: "Send crafted request",
      progressPercent: 40,
      estimatedRemainingMs: 60000,
      elapsedMs: 15000,
      startedAt: "2026-07-30T09:00:00.000Z",
      completedAt: null,
      cancelledAt: null,
      failureCode: null,
      safeFailureMessage: null,
      createdAt: "2026-07-30T09:00:00.000Z",
      updatedAt: "2026-07-30T09:00:00.000Z",
    };

    const event: AttackRuntimeEvent = {
      id: "77777777-7777-4777-8777-777777777777",
      campaignId: campaign.id,
      executionId: execution.id,
      stepId: null,
      organizationId: campaign.organizationId,
      projectId: campaign.projectId,
      correlationId: campaign.correlationId,
      eventType: "attack_step_started",
      payload: { stepLabel: "Send crafted request" },
      occurredAt: "2026-07-30T09:01:00.000Z",
      createdAt: "2026-07-30T09:01:00.000Z",
    };

    const view = buildAttackCenterCampaignView({
      projectId: campaign.projectId,
      campaign,
      executions: [execution],
      scenarios: [scenario],
      events: [event],
    });

    expect(view.kind).toBe("campaign");
    expect(view.executions[0].scenarioTitle).toBe("Workflow bypass");
    expect(view.feed[0].label).toBe("Step started: Send crafted request");
  });

  it("builds execution view with ordered steps", () => {
    const execution: AttackExecution = {
      id: "33333333-3333-4333-8333-333333333333",
      campaignId: campaign.id,
      scenarioId: "22222222-2222-4222-8222-222222222222",
      scanId: campaign.scanId,
      scanJobId: null,
      projectId: campaign.projectId,
      organizationId: campaign.organizationId,
      commitSha: campaign.commitSha,
      runtimeMode: campaign.runtimeMode,
      correlationId: campaign.correlationId,
      attackerProfile: {},
      protectedAssets: [],
      status: "executing",
      currentStage: "executing",
      currentStepId: "88888888-8888-4888-8888-888888888888",
      currentStepTitle: "Observe response",
      progressPercent: 55,
      estimatedRemainingMs: 30000,
      elapsedMs: 20000,
      startedAt: "2026-07-30T09:00:00.000Z",
      completedAt: null,
      cancelledAt: null,
      failureCode: null,
      safeFailureMessage: null,
      createdAt: "2026-07-30T09:00:00.000Z",
      updatedAt: "2026-07-30T09:00:00.000Z",
    };

    const steps: AttackExecutionStep[] = [
      {
        id: "88888888-8888-4888-8888-888888888888",
        executionId: execution.id,
        campaignId: campaign.id,
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        sortOrder: 1,
        kind: "observe",
        label: "Observe response",
        weight: 20,
        status: "running",
        startedAt: "2026-07-30T09:01:00.000Z",
        completedAt: null,
        durationMs: null,
        failureCode: null,
        metadata: {},
        createdAt: "2026-07-30T09:00:00.000Z",
        updatedAt: "2026-07-30T09:01:00.000Z",
      },
    ];

    const view = buildAttackCenterExecutionView({
      projectId: campaign.projectId,
      execution,
      steps,
      events: [],
    });

    expect(view.kind).toBe("execution");
    expect(view.steps).toHaveLength(1);
    expect(view.execution.currentStepTitle).toBe("Observe response");
  });

  it("builds finding view with mitigation and safe fix", () => {
    const finding: AttackFinding = {
      id: "99999999-9999-4999-8999-999999999999",
      executionId: "33333333-3333-4333-8333-333333333333",
      campaignId: campaign.id,
      scenarioId: "22222222-2222-4222-8222-222222222222",
      organizationId: campaign.organizationId,
      projectId: campaign.projectId,
      evidenceId: null,
      title: "Checkout bypass confirmed",
      description: "Payment state skipped",
      category: "business_logic",
      severity: "high",
      confidence: 0.9,
      outcome: "confirmed",
      impact: "Unauthorized order completion",
      rootCause: "Missing server-side transition guard",
      metadata: {},
      confirmedAt: "2026-07-30T09:05:00.000Z",
      createdAt: "2026-07-30T09:05:00.000Z",
      updatedAt: "2026-07-30T09:05:00.000Z",
    };

    const view = buildAttackCenterFindingView({
      projectId: campaign.projectId,
      finding,
      mitigation: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        findingId: finding.id,
        executionId: finding.executionId,
        campaignId: campaign.id,
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        plainLanguageExplanation: "The server trusts client-side state.",
        rootCause: "Missing server-side transition guard",
        recommendedProtection: "Validate payment state on the server before order completion.",
        likelyAffectedFiles: ["app/checkout/route.ts"],
        implementationSteps: ["Add transition guard", "Add regression test"],
        implementationRisk: "low",
        safeFixConfidence: 0.85,
        estimatedLoc: 12,
        rollbackGuidance: "Revert guard commit",
        residualRisk: "Low after guard is deployed",
        metadata: {},
        createdAt: "2026-07-30T09:05:00.000Z",
        updatedAt: "2026-07-30T09:05:00.000Z",
      },
      safeFix: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        mitigationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        findingId: finding.id,
        executionId: finding.executionId,
        campaignId: campaign.id,
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        safeFixRecordId: null,
        status: "ready",
        cursorPrompt: "Add server-side payment guard before checkout completion.",
        patchProposal: null,
        pullRequestProposal: null,
        requiredTests: ["checkout cannot complete without payment"],
        rollbackPlan: "Revert guard commit",
        affectedFiles: ["app/checkout/route.ts"],
        confidence: 0.85,
        implementationRisk: "low",
        estimatedLoc: 12,
        metadata: { attackFindingId: finding.id },
        createdAt: "2026-07-30T09:05:00.000Z",
        updatedAt: "2026-07-30T09:05:00.000Z",
      },
      evidence: null,
      verification: null,
    });

    expect(view.kind).toBe("finding");
    expect(view.safeFix?.attackFindingId).toBe(finding.id);
    expect(view.mitigation?.implementationSteps).toHaveLength(2);
  });
});
