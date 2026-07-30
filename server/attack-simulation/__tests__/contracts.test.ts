import { describe, expect, it } from "vitest";
import {
  ATTACK_CAMPAIGN_STATUSES,
  ATTACK_EXECUTION_STATUSES,
  ATTACK_RUNTIME_EVENT_TYPES,
  ATTACK_RUNTIME_MODES,
  attackCampaignSchema,
  attackExecutionSchema,
  attackExecutionStepSchema,
  attackRuntimeEventSchema,
  createAttackCampaignInputSchema,
  createAttackRuntimeEventInputSchema,
  DEFAULT_ATTACK_STEP_TEMPLATE,
} from "@/server/attack-simulation";

describe("attack simulation contracts", () => {
  const campaignId = "11111111-1111-4111-8111-111111111111";
  const executionId = "22222222-2222-4222-8222-222222222222";
  const stepId = "33333333-3333-4333-8333-333333333333";
  const scanId = "44444444-4444-4444-8444-444444444444";
  const projectId = "55555555-5555-4555-8555-555555555555";
  const organizationId = "66666666-6666-4666-8666-666666666666";
  const now = new Date().toISOString();

  it("accepts a valid attack campaign aggregate root", () => {
    const campaign = attackCampaignSchema.parse({
      id: campaignId,
      scanId,
      scanJobId: null,
      projectId,
      organizationId,
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
      runtimeMode: "mock",
      status: "planned",
      correlationId: campaignId,
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
      createdAt: now,
      updatedAt: now,
    });

    expect(campaign.status).toBe("planned");
    expect(campaign.runtimeMode).toBe("mock");
  });

  it("requires scan and tenant fields when creating a campaign", () => {
    const parsed = createAttackCampaignInputSchema.safeParse({
      scanId,
      scanJobId: null,
      projectId,
      organizationId,
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
      runtimeMode: "static",
    });
    expect(parsed.success).toBe(true);
  });

  it("includes realtime fields on attack execution", () => {
    const execution = attackExecutionSchema.parse({
      id: executionId,
      campaignId,
      scenarioId: stepId,
      scanId,
      scanJobId: null,
      projectId,
      organizationId,
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
      runtimeMode: "mock",
      correlationId: campaignId,
      attackerProfile: { role: "anonymous" },
      protectedAssets: [{ type: "project", id: projectId }],
      status: "executing",
      currentStage: "executing",
      currentStepId: stepId,
      currentStepTitle: "Execute request",
      elapsedMs: 1200,
      progressPercent: 45,
      estimatedRemainingMs: 8000,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      cancelledAt: null,
      failureCode: null,
      safeFailureMessage: null,
      createdAt: now,
    });

    expect(execution.currentStepTitle).toBe("Execute request");
    expect(execution.progressPercent).toBe(45);
  });

  it("defines weighted default execution steps totaling 100", () => {
    const total = DEFAULT_ATTACK_STEP_TEMPLATE.reduce((sum, step) => sum + step.weight, 0);
    expect(total).toBe(100);
    expect(DEFAULT_ATTACK_STEP_TEMPLATE).toHaveLength(8);
  });

  it("validates execution step weight and timing fields", () => {
    const step = attackExecutionStepSchema.parse({
      id: stepId,
      executionId,
      campaignId,
      organizationId,
      projectId,
      sortOrder: 3,
      kind: "execute_request",
      label: "Execute request",
      weight: 25,
      status: "running",
      startedAt: now,
      completedAt: null,
      durationMs: null,
      failureCode: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    expect(step.weight).toBe(25);
  });

  it("validates runtime event types for streaming", () => {
    expect(ATTACK_RUNTIME_EVENT_TYPES).toContain("attack_step_started");
    expect(ATTACK_RUNTIME_EVENT_TYPES).toContain("protection_verified");

    const event = attackRuntimeEventSchema.parse({
      id: stepId,
      campaignId,
      executionId,
      stepId,
      organizationId,
      projectId,
      correlationId: campaignId,
      eventType: "attack_step_started",
      payload: { stepLabel: "Execute request", progressPercent: 45 },
      occurredAt: now,
      createdAt: now,
    });
    expect(event.eventType).toBe("attack_step_started");
  });

  it("rejects invalid runtime modes and campaign statuses", () => {
    expect(ATTACK_RUNTIME_MODES).not.toContain("production");
    expect(ATTACK_CAMPAIGN_STATUSES).toContain("running");
    expect(ATTACK_EXECUTION_STATUSES).toContain("protected");

    const invalidEvent = createAttackRuntimeEventInputSchema.safeParse({
      campaignId,
      executionId,
      stepId: null,
      organizationId,
      projectId,
      correlationId: campaignId,
      eventType: "not_a_real_event",
      payload: {},
    });
    expect(invalidEvent.success).toBe(false);
  });
});
