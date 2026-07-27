import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import { discoverBusinessWorkflows, buildBusinessLogicTeamContext } from "../../discovery";
import { buildBusinessDomainModel } from "../build-domain-model";
import { normalizeDiscoveredEntities } from "../normalize-entity";
import { validateStateMachine } from "../state-machine-validation";
import { primaryHappyPathStateIds } from "../state-machine";

function stripeDiscovery(): DiscoveryReport {
  return {
    reportId: "d1",
    projectId: "p1",
    organizationId: "o1",
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "Subscription SaaS",
    detectedTechnologies: [],
    authenticationProviders: [
      { id: "clerk", name: "Clerk", category: "auth", confidence: 0.9, evidence: [] },
    ],
    database: [{ id: "pg", name: "Postgres", category: "database", confidence: 0.9, evidence: [] }],
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
    ],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.9,
    cached: false,
  };
}

describe("RT9 Domain Model — Slice 2", () => {
  it("normalizes discovered entities with ownership and evidence", () => {
    const discovered = discoverBusinessWorkflows(stripeDiscovery());
    const entities = normalizeDiscoveredEntities(discovered.entities);
    expect(entities.length).toBeGreaterThan(0);
    for (const entity of entities) {
      expect(entity.id).toBeTruthy();
      expect(entity.metadata.evidence.length).toBeGreaterThan(0);
      expect(entity.lifecycle.phase).toBeTruthy();
      expect(entity.value.kind).toBeTruthy();
    }
    const user = entities.find((e) => e.kind === "user");
    const payment = entities.find((e) => e.kind === "payment");
    if (user && payment) {
      expect(payment.ownership.ownerEntityId).toBe(user.id);
    }
  });

  it("builds deterministic FSMs for each discovered workflow", () => {
    const discovery = stripeDiscovery();
    const context = buildBusinessLogicTeamContext({
      businessLogicTeamRunId: "run-bl",
      redTeamRunId: "rt-1",
      organizationId: "o1",
      projectId: "p1",
      discovery,
      plan: { planId: "plan", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });
    const domain = buildBusinessDomainModel(context);

    expect(domain.workflows.length).toBe(context.workflows.length);
    expect(domain.stateMachines.length).toBe(context.workflows.length);

    const first = domain.stateMachines[0]!;
    const secondRun = buildBusinessDomainModel(context);
    expect(secondRun.stateMachines[0]!.states.map((s) => s.id)).toEqual(
      first.states.map((s) => s.id)
    );

    for (const machine of domain.stateMachines) {
      expect(machine.terminalStateIds.length).toBeGreaterThan(0);
      expect(machine.states.some((s) => s.id === machine.initialStateId)).toBe(true);
      const issues = validateStateMachine(machine);
      expect(issues.filter((i) => i.code === "missing_terminal_state")).toHaveLength(0);
      expect(issues.filter((i) => i.code === "unreachable_state")).toHaveLength(0);
      expect(issues.filter((i) => i.code === "duplicate_transition")).toHaveLength(0);
    }
  });

  it("validates happy-path ordering hints against transitions", () => {
    const context = buildBusinessLogicTeamContext({
      businessLogicTeamRunId: "run-bl",
      redTeamRunId: "rt-1",
      organizationId: "o1",
      projectId: "p1",
      discovery: stripeDiscovery(),
      plan: { planId: "plan", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });
    const domain = buildBusinessDomainModel(context);
    const checkout = domain.stateMachines.find((m) =>
      m.metadata.discoveredWorkflowKind === "payment_checkout"
    );
    expect(checkout).toBeDefined();
    const hints = primaryHappyPathStateIds("payment_checkout");
    for (let i = 0; i < hints.length - 1; i += 1) {
      const from = hints[i]!;
      const to = hints[i + 1]!;
      expect(
        checkout!.transitions.some((t) => t.fromStateId === from && t.toStateId === to)
      ).toBe(true);
    }
  });

  it("includes rollback transitions on checkout FSM", () => {
    const context = buildBusinessLogicTeamContext({
      businessLogicTeamRunId: "run-bl",
      redTeamRunId: "rt-1",
      organizationId: "o1",
      projectId: "p1",
      discovery: stripeDiscovery(),
      plan: { planId: "plan", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });
    const domain = buildBusinessDomainModel(context);
    const checkout = domain.stateMachines.find(
      (m) => m.metadata.discoveredWorkflowKind === "payment_checkout"
    );
    expect(
      checkout?.transitions.some((t) => t.rollbackTargetStateId != null)
    ).toBe(true);
  });

  it("regression: Slice 1 discovery count matches domain workflow count", () => {
    const discovery = discoverBusinessWorkflows(stripeDiscovery());
    const context = buildBusinessLogicTeamContext({
      businessLogicTeamRunId: "run-bl",
      redTeamRunId: "rt-1",
      organizationId: "o1",
      projectId: "p1",
      discovery: stripeDiscovery(),
      plan: { planId: "plan", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });
    const domain = buildBusinessDomainModel(context);
    expect(domain.workflows.length).toBe(discovery.workflows.length);
  });
});
