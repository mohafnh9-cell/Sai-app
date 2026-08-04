import { describe, expect, it } from "vitest";
import { ATTACK_ADAPTER_CATALOG } from "../planner/adapter-catalog";
import {
  assertMvpAdapterModulesComplete,
  listAttackAdapterModules,
  resolveAttackAdapterModule,
} from "../adapters/registry";
import { createSafeRuntimeSession } from "../runtime/safe-runtime";
import { evaluateAttackOutcome } from "../mitigation/evaluate-outcome";
import { runAttackExecutionSteps } from "../executor/run-execution-steps";
import { DEFAULT_ATTACK_STEP_TEMPLATE } from "../contracts/attack-execution-step";

describe("MVP attack adapter modules", () => {
  it("registers execution modules for every catalog adapter", () => {
    expect(assertMvpAdapterModulesComplete()).toEqual([]);
    expect(listAttackAdapterModules()).toHaveLength(ATTACK_ADAPTER_CATALOG.length);
  });

  it("idor adapter emits exploit signals in vulnerable mock mode", async () => {
    const adapterModule = resolveAttackAdapterModule("idor-cross-tenant");
    expect(adapterModule).toBeDefined();

    const session = createSafeRuntimeSession({
      mode: "mock",
      tenant: {
        organizationId: "66666666-6666-4666-8666-666666666666",
        projectId: "55555555-5555-4555-8555-555555555555",
        campaignId: "11111111-1111-4111-8111-111111111111",
        executionId: "22222222-2222-4222-8222-222222222222",
        correlationId: "33333333-3333-4333-8333-333333333333",
      },
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
    });

    const result = adapterModule!.executeStep({
      adapterId: "idor-cross-tenant",
      stepKind: "execute_request",
      stepLabel: "Execute request",
      guard: session.guard,
      fixtures: { simulationOutcome: "vulnerable" },
    });

    expect(result.observedBehavior.toLowerCase()).toContain("cross-tenant");
    expect(result.statusCode).toBe(200);

    const evaluation = evaluateAttackOutcome({
      evidence: {
        confidence: 0.8,
        expectedBehavior: "Tenant isolation",
        observedBehavior: result.observedBehavior,
        sideEffects: result.sideEffects ?? {},
        statusCode: result.statusCode ?? null,
      },
      scenario: { adapterId: "idor-cross-tenant", title: "Cross-tenant IDOR", category: "authorization" },
    });

    expect(evaluation.outcome).toBe("confirmed");
  });

  it("idor adapter reports protection signals when simulationOutcome is protected", async () => {
    const adapterModule = resolveAttackAdapterModule("idor-cross-tenant")!;
    const session = createSafeRuntimeSession({
      mode: "mock",
      tenant: {
        organizationId: "66666666-6666-4666-8666-666666666666",
        projectId: "55555555-5555-4555-8555-555555555555",
        campaignId: "11111111-1111-4111-8111-111111111111",
        executionId: "22222222-2222-4222-8222-222222222222",
        correlationId: "33333333-3333-4333-8333-333333333333",
      },
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
    });

    const result = adapterModule.executeStep({
      adapterId: "idor-cross-tenant",
      stepKind: "execute_request",
      stepLabel: "Execute request",
      guard: session.guard,
      fixtures: { simulationOutcome: "protected" },
    });

    const evaluation = evaluateAttackOutcome({
      evidence: {
        confidence: 0.8,
        expectedBehavior: "Tenant isolation",
        observedBehavior: result.observedBehavior,
        sideEffects: result.sideEffects ?? {},
        statusCode: result.statusCode ?? null,
      },
      scenario: { adapterId: "idor-cross-tenant", title: "Cross-tenant IDOR", category: "authorization" },
    });

    expect(evaluation.outcome).toBe("not_exploitable");
  });

  it("runs full step template through adapter-aware mock runtime", async () => {
    const steps = DEFAULT_ATTACK_STEP_TEMPLATE.map((template, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index}`,
      kind: template.kind,
      label: template.label,
      sortOrder: template.sortOrder,
      weight: template.weight,
      status: "pending" as const,
    }));

    const session = createSafeRuntimeSession({
      mode: "mock",
      tenant: {
        organizationId: "66666666-6666-4666-8666-666666666666",
        projectId: "55555555-5555-4555-8555-555555555555",
        campaignId: "11111111-1111-4111-8111-111111111111",
        executionId: "22222222-2222-4222-8222-222222222222",
        correlationId: "33333333-3333-4333-8333-333333333333",
      },
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
    });

    const result = await runAttackExecutionSteps({
      context: {
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
          attackerProfile: { role: "tenant_b" },
          protectedAssets: [{ type: "project", label: "Tenant A project" }],
        },
        scenario: {
          id: "44444444-4444-4444-8444-444444444444",
          adapterId: "workflow-bypass",
          metadata: {},
        },
        steps,
      },
      session,
      fixtures: { simulationOutcome: "vulnerable" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stepResults.length).toBe(steps.length);
      const executeStep = result.stepResults.find((row) => row.stepKind === "execute_request");
      expect(executeStep?.runtimeResult.observedBehavior.toLowerCase()).toContain("workflow bypass");
    }
  });
});
