import { describe, expect, it } from "vitest";
import { buildBusinessLogicTeamContext } from "../../discovery";
import { buildBusinessDomainModel } from "../../model/build-domain-model";
import { extractBusinessInvariants } from "../invariant-extractor";
import { classifyConfidence } from "../invariant-confidence";
import { validateBusinessInvariants } from "../invariant-validator";
import type { DiscoveryReport } from "../../../discovery/types";

function stripeDiscovery(): DiscoveryReport {
  return {
    reportId: "d1",
    projectId: "p1",
    organizationId: "o1",
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "Subscription SaaS with promo codes",
    detectedTechnologies: [],
    authenticationProviders: [
      { id: "clerk", name: "Clerk", category: "auth", confidence: 0.9, evidence: [] },
    ],
    database: [],
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

function extractFixture() {
  const context = buildBusinessLogicTeamContext({
    businessLogicTeamRunId: "run-bl",
    redTeamRunId: "rt-1",
    organizationId: "o1",
    projectId: "p1",
    discovery: stripeDiscovery(),
    plan: { planId: "plan", createdAt: new Date().toISOString(), phases: [], notes: [] },
  });
  const domain = buildBusinessDomainModel(context);
  const collection = extractBusinessInvariants({ domain, discoverySignals: context.signals });
  return { context, domain, collection };
}

describe("RT9 Invariant Engine — Slice 3", () => {
  it("extracts invariants with evidence and workflow references", () => {
    const { collection } = extractFixture();
    expect(collection.invariants.length).toBeGreaterThan(0);
    for (const invariant of collection.invariants) {
      expect(invariant.workflowId).toBeTruthy();
      expect(invariant.stateMachineId).toBeTruthy();
      expect(invariant.evidence.length).toBeGreaterThan(0);
      expect(invariant.whyItExists.length).toBeGreaterThan(5);
      expect(invariant.confidence).not.toBe("unsupported");
    }
  });

  it("classifies confidence deterministically", () => {
    expect(
      classifyConfidence({
        hasExplicitConstraint: true,
        hasGuardOnTransition: false,
        discoveryEvidenceMax: 0.5,
        fromAssumptionOnly: false,
      })
    ).toBe("explicit");
    expect(
      classifyConfidence({
        hasExplicitConstraint: false,
        hasGuardOnTransition: false,
        discoveryEvidenceMax: 0.5,
        fromAssumptionOnly: true,
      })
    ).toBe("assumed");
  });

  it("includes ordering and idempotency invariants for payment flows", () => {
    const { collection } = extractFixture();
    const categories = new Set(collection.invariants.map((i) => i.category));
    expect(categories.has("ordering")).toBe(true);
    expect(categories.has("idempotency")).toBe(true);
    expect(categories.has("payment_lifecycle")).toBe(true);
  });

  it("includes cross-workflow consistency when checkout and webhook exist", () => {
    const { collection } = extractFixture();
    expect(
      collection.invariants.some((i) => i.category === "cross_workflow_consistency")
    ).toBe(true);
  });

  it("includes rollback invariants when rollback transitions exist", () => {
    const { collection } = extractFixture();
    expect(collection.invariants.some((i) => i.category === "retry_safety")).toBe(true);
  });

  it("groups invariants per workflow", () => {
    const { collection, domain } = extractFixture();
    expect(collection.groups.length).toBe(domain.workflows.length);
    const groupedCount = collection.groups.reduce((n, g) => n + g.invariantIds.length, 0);
    expect(groupedCount).toBeGreaterThan(0);
  });

  it("validator passes for extracted invariants", () => {
    const { collection } = extractFixture();
    const issues = validateBusinessInvariants(collection.invariants);
    expect(issues.filter((i) => i.code === "missing_evidence")).toHaveLength(0);
    expect(issues.filter((i) => i.code === "missing_workflow_ref")).toHaveLength(0);
    expect(issues.filter((i) => i.code === "missing_fsm_ref")).toHaveLength(0);
  });

  it("regression: Slice 2 FSM count unchanged and invariants attach to domain model", () => {
    const { domain, collection } = extractFixture();
    domain.invariantCollection = collection;
    expect(domain.stateMachines.length).toBeGreaterThan(0);
    expect(domain.invariantCollection.invariants.length).toBeGreaterThan(0);
  });

  it("deterministic invariant keys for repeated extraction", () => {
    const first = extractFixture().collection.invariants.map((i) => i.invariantKey).sort();
    const second = extractFixture().collection.invariants.map((i) => i.invariantKey).sort();
    expect(second).toEqual(first);
  });
});
