import { describe, expect, it } from "vitest";
import { createSafeRuntimeSession } from "../runtime/safe-runtime";
import { runAttackExecutionSteps } from "../executor/run-execution-steps";
import type { AttackExecutionRunContext } from "../executor/types";

function buildContext(
  overrides: Partial<AttackExecutionRunContext> = {}
): AttackExecutionRunContext {
  return {
    campaign: {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "66666666-6666-4666-8666-666666666666",
      projectId: "55555555-5555-4555-8555-555555555555",
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
      runtimeMode: "mock",
      correlationId: "33333333-3333-4333-8333-333333333333",
      status: "queued",
    },
    execution: {
      id: "22222222-2222-4222-8222-222222222222",
      campaignId: "11111111-1111-4111-8111-111111111111",
      scenarioId: "44444444-4444-4444-8444-444444444444",
      organizationId: "66666666-6666-4666-8666-666666666666",
      projectId: "55555555-5555-4555-8555-555555555555",
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
      runtimeMode: "mock",
      correlationId: "33333333-3333-4333-8333-333333333333",
      status: "queued",
      attackerProfile: { role: "simulated_attacker" },
    },
    scenario: {
      id: "44444444-4444-4444-8444-444444444444",
      adapterId: "idor-cross-tenant",
      metadata: {},
    },
    steps: [
      {
        id: "aaaa0001-0001-4001-8001-000000000001",
        kind: "validate_preconditions",
        label: "Validate preconditions",
        sortOrder: 0,
        weight: 10,
        status: "pending",
      },
      {
        id: "aaaa0002-0002-4002-8002-000000000002",
        kind: "execute_request",
        label: "Execute request",
        sortOrder: 3,
        weight: 25,
        status: "pending",
      },
      {
        id: "aaaa0003-0003-4003-8003-000000000003",
        kind: "cleanup",
        label: "Cleanup",
        sortOrder: 7,
        weight: 5,
        status: "pending",
      },
    ],
    ...overrides,
  };
}

describe("runAttackExecutionSteps", () => {
  it("runs all mock steps to completion", async () => {
    const context = buildContext();
    const session = createSafeRuntimeSession({
      mode: "mock",
      tenant: {
        organizationId: context.execution.organizationId,
        projectId: context.execution.projectId,
        campaignId: context.execution.campaignId,
        executionId: context.execution.id,
        correlationId: context.execution.correlationId,
      },
      commitSha: context.execution.commitSha,
    });

    const started: string[] = [];
    const completed: string[] = [];

    const result = await runAttackExecutionSteps({
      context,
      session,
      onBeforeStep: (step) => {
        started.push(step.id);
      },
      onAfterStep: (step) => {
        completed.push(step.id);
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.terminalStatus).toBe("completed");
      expect(result.stepResults).toHaveLength(3);
    }
    expect(started).toHaveLength(3);
    expect(completed).toHaveLength(3);
  });

  it("stops on blocked runtime outcome", async () => {
    const context = buildContext();
    const session = createSafeRuntimeSession({
      mode: "mock",
      tenant: {
        organizationId: context.execution.organizationId,
        projectId: context.execution.projectId,
        campaignId: context.execution.campaignId,
        executionId: context.execution.id,
        correlationId: context.execution.correlationId,
      },
      commitSha: context.execution.commitSha,
      targetUrl: "https://evil.example.com",
    });

    const result = await runAttackExecutionSteps({ context, session });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.terminalStatus).toBe("blocked");
      expect(result.stepResults).toHaveLength(1);
    }
  });

  it("skips already completed steps for idempotent retries", async () => {
    const context = buildContext({
      steps: buildContext().steps.map((step, index) =>
        index === 0 ? { ...step, status: "completed" as const } : step
      ),
    });
    const session = createSafeRuntimeSession({
      mode: "mock",
      tenant: {
        organizationId: context.execution.organizationId,
        projectId: context.execution.projectId,
        campaignId: context.execution.campaignId,
        executionId: context.execution.id,
        correlationId: context.execution.correlationId,
      },
      commitSha: context.execution.commitSha,
    });

    const result = await runAttackExecutionSteps({ context, session });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skippedSteps).toBe(1);
      expect(result.stepResults).toHaveLength(2);
    }
  });

  it("honours cancellation signal", async () => {
    const context = buildContext();
    const session = createSafeRuntimeSession({
      mode: "mock",
      tenant: {
        organizationId: context.execution.organizationId,
        projectId: context.execution.projectId,
        campaignId: context.execution.campaignId,
        executionId: context.execution.id,
        correlationId: context.execution.correlationId,
      },
      commitSha: context.execution.commitSha,
    });

    const result = await runAttackExecutionSteps({
      context,
      session,
      signal: { cancelled: true },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.terminalStatus).toBe("cancelled");
      expect(result.stepResults).toHaveLength(0);
    }
  });
});
