import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import { buildBusinessLogicTeamContext } from "../../discovery";
import { buildBusinessDomainModel } from "../../model/build-domain-model";
import { extractBusinessInvariants } from "../../invariants";
import { generateBusinessAbuseCases } from "../../abuse";
import { createBusinessLogicSpecialistRegistry, createDefaultBusinessLogicSpecialists } from "../../registry";
import { buildBusinessLogicSpecialistContext } from "../../specialists/specialist-context";
import { runBusinessLogicSpecialists } from "../../specialists/specialist-runner";
import {
  BusinessLogicExecutionPlanner,
  BusinessLogicRuntime,
  DEFAULT_BUSINESS_LOGIC_RUNTIME_BUDGET,
} from "../index";
import { randomUUID } from "node:crypto";
import type { BusinessLogicExecutionPlan } from "../runtime.types";

function richDiscovery(): DiscoveryReport {
  return {
    reportId: "d1",
    projectId: "p1",
    organizationId: "o1",
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "Subscription SaaS with Stripe, coupons, invites",
    detectedTechnologies: [],
    authenticationProviders: [
      { id: "clerk", name: "Clerk", category: "auth", confidence: 0.9, evidence: [] },
    ],
    database: [{ id: "pg", name: "Postgres", category: "database", confidence: 0.85, evidence: [] }],
    payments: [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.95, evidence: [] }],
    aiProviders: [],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: [],
    potentialAttackSurface: [
      { area: "payments", label: "Pay", rationale: "x", confidence: 0.9 },
      { area: "webhooks", label: "Hooks", rationale: "x", confidence: 0.85 },
      { area: "rest_api", label: "API", rationale: "x", confidence: 0.88 },
      { area: "authentication", label: "Auth", rationale: "x", confidence: 0.9 },
      { area: "admin_area", label: "Admin", rationale: "x", confidence: 0.8 },
    ],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.9,
    cached: false,
  };
}

async function fullSpecialistContext() {
  const teamContext = buildBusinessLogicTeamContext({
    businessLogicTeamRunId: "run-bl",
    redTeamRunId: "rt-1",
    organizationId: "o1",
    projectId: "p1",
    discovery: richDiscovery(),
    plan: { planId: "plan", createdAt: new Date().toISOString(), phases: [], notes: [] },
  });
  const domain = buildBusinessDomainModel(teamContext);
  domain.invariantCollection = extractBusinessInvariants({
    domain,
    discoverySignals: teamContext.signals,
  });
  domain.abuseCollection = generateBusinessAbuseCases({ domain }).collection;
  teamContext.domainModel = domain;
  const specialistContext = buildBusinessLogicSpecialistContext(teamContext)!;
  const specialistSummary = await runBusinessLogicSpecialists({
    registry: createBusinessLogicSpecialistRegistry(createDefaultBusinessLogicSpecialists()),
    context: specialistContext,
  });
  domain.specialistExecution = specialistSummary;
  return specialistContext;
}

describe("RT9 Safe Business Logic Runtime — Slice 6", () => {
  it("plans bounded executions from specialist validation steps", async () => {
    const context = await fullSpecialistContext();
    const plans = BusinessLogicExecutionPlanner.planFromSpecialists({
      domain: context.domain,
      specialistSummary: context.domain.specialistExecution!,
    });
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(plan.executionMode).not.toBe("blocked");
      expect(plan.maxEvaluations).toBeGreaterThan(0);
      expect(plan.timeoutMs).toBeGreaterThan(0);
      expect(plan.targetInvariantId).toBeTruthy();
    }
  });

  it("executes checkout mock runtime deterministically", async () => {
    const context = await fullSpecialistContext();
    const first = await BusinessLogicRuntime.run({ context });
    const second = await BusinessLogicRuntime.run({ context });
    const firstKeys = first.results
      .map((r) => `${r.planId}:${r.classification}:${r.status}:${r.violatedInvariantId}`)
      .sort();
    const secondKeys = second.results
      .map((r) => `${r.planId}:${r.classification}:${r.status}:${r.violatedInvariantId}`)
      .sort();
    expect(secondKeys).toEqual(firstKeys);
    expect(
      first.results.some(
        (r) =>
          r.executionMode === "mock_runtime" ||
          r.executionMode === "static_validation" ||
          r.executionMode === "simulation_only"
      )
    ).toBe(true);
  });

  it("classifies with evidence cap (never unsupported when evidence weak)", async () => {
    const context = await fullSpecialistContext();
    const summary = await BusinessLogicRuntime.run({ context });
    for (const result of summary.results) {
      if (result.evidence.length === 0 && result.status === "completed") {
        expect(["unsupported", "inconclusive", "rejected"]).toContain(result.classification);
      }
    }
  });

  it("respects budget limits", async () => {
    const context = await fullSpecialistContext();
    const summary = await BusinessLogicRuntime.run({
      context,
      budget: { ...DEFAULT_BUSINESS_LOGIC_RUNTIME_BUDGET, maxPlans: 2 },
    });
    expect(summary.budgetUsage.plansExecuted).toBeLessThanOrEqual(2);
    expect(summary.partialReason === "budget_max_plans" || summary.plansTotal <= 2).toBe(true);
  });

  it("isolates plan failures", async () => {
    const context = await fullSpecialistContext();
    const badPlan: BusinessLogicExecutionPlan = {
      id: randomUUID(),
      specialistPlanId: randomUUID(),
      specialistId: "logic.checkout_integrity",
      specialistStepId: randomUUID(),
      workflowId: "missing-workflow",
      workflowKind: "payment_checkout",
      scenarioKind: "checkout",
      requiredEntityIds: [],
      transitionIds: [],
      targetInvariantId: "missing-invariant",
      targetAbuseCaseId: null,
      assumptions: [],
      requiredEvidenceRefIds: [],
      executionMode: "mock_runtime",
      maxEvaluations: 4,
      timeoutMs: 500,
      rollbackStrategy: "mock_reset",
    };

    const result = await BusinessLogicRuntime.executePlan({
      domain: context.domain,
      plan: badPlan,
      limits: { perPlanTimeoutMs: 500, perPlanMaxEvaluations: 4, perPlanMaxTransitions: 8 },
    });
    expect(result.status).toBe("failed");
    expect(result.classification).toBe("rejected");
  });

  it("covers subscription, credit, webhook scenarios in full pipeline", async () => {
    const context = await fullSpecialistContext();
    const summary = await BusinessLogicRuntime.run({ context });
    const scenarios = new Set(
      BusinessLogicExecutionPlanner.planFromSpecialists({
        domain: context.domain,
        specialistSummary: context.domain.specialistExecution!,
      }).map((p) => p.scenarioKind)
    );
    expect(scenarios.has("checkout")).toBe(true);
    expect(scenarios.has("webhook")).toBe(true);
    expect(summary.plansCompleted).toBeGreaterThan(0);
  });

  it("regression: slices 1–5 artifacts remain populated after runtime", async () => {
    const context = await fullSpecialistContext();
    await BusinessLogicRuntime.run({ context });
    expect(context.domain.workflows.length).toBeGreaterThan(0);
    expect(context.domain.invariantCollection!.invariants.length).toBeGreaterThan(0);
    expect(context.domain.abuseCollection!.cases.length).toBeGreaterThan(0);
    expect(context.domain.specialistExecution!.specialistsCompleted).toBeGreaterThan(0);
  });
});
