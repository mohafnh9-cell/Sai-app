import { describe, expect, it } from "vitest";
import { buildBusinessLogicTeamContext } from "../../discovery";
import { buildBusinessDomainModel } from "../../model/build-domain-model";
import { extractBusinessInvariants } from "../../invariants";
import { generateBusinessAbuseCases } from "../abuse-generator";
import { validateAbuseCase } from "../abuse-validator";
import { abuseConfidenceFromInvariant } from "../abuse-confidence";
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

function fullDomain() {
  const context = buildBusinessLogicTeamContext({
    businessLogicTeamRunId: "run-bl",
    redTeamRunId: "rt-1",
    organizationId: "o1",
    projectId: "p1",
    discovery: stripeDiscovery(),
    plan: { planId: "plan", createdAt: new Date().toISOString(), phases: [], notes: [] },
  });
  const domain = buildBusinessDomainModel(context);
  domain.invariantCollection = extractBusinessInvariants({
    domain,
    discoverySignals: context.signals,
  });
  return domain;
}

describe("RT9 Abuse Generation — Slice 4", () => {
  it("generates abuse cases from invariants only", () => {
    const domain = fullDomain();
    const result = generateBusinessAbuseCases({ domain });
    expect(result.acceptedCount).toBeGreaterThan(0);
    for (const abuseCase of result.collection.cases) {
      expect(abuseCase.targetInvariantId).toBeTruthy();
      expect(abuseCase.sequence.steps.length).toBeGreaterThan(0);
      expect(abuseCase.confidence).not.toBe("unsupported");
    }
  });

  it("propagates confidence from invariant levels", () => {
    expect(abuseConfidenceFromInvariant("explicit", 0.9)).toBe("confirmed");
    expect(abuseConfidenceFromInvariant("assumed", 0.6)).toBe("possible");
  });

  it("produces structured sequences with invariant violation summary", () => {
    const domain = fullDomain();
    const result = generateBusinessAbuseCases({ domain });
    const sample = result.collection.cases[0]!;
    expect(sample.sequence.invariantViolationSummary.length).toBeGreaterThan(0);
    expect(sample.sequence.businessConsequence.length).toBeGreaterThan(0);
    expect(sample.sequence.steps.every((s) => s.order >= 1)).toBe(true);
  });

  it("generates cross-workflow abuse when checkout and webhook workflows exist", () => {
    const domain = fullDomain();
    const result = generateBusinessAbuseCases({ domain });
    expect(result.collection.cases.some((c) => c.category === "cross_workflow_abuse")).toBe(true);
  });

  it("generates replay and concurrency categories when invariants match", () => {
    const domain = fullDomain();
    const result = generateBusinessAbuseCases({ domain });
    const categories = new Set(result.collection.cases.map((c) => c.category));
    expect(categories.has("webhook_replay") || categories.has("duplicate_execution")).toBe(true);
  });

  it("rejects cases with missing invariants", () => {
    const domain = fullDomain();
    const result = generateBusinessAbuseCases({ domain });
    const sample = result.collection.cases[0]!;
    const issues = validateAbuseCase({ ...sample, targetInvariantId: "missing" }, domain);
    expect(issues.some((i) => i.code === "missing_invariant")).toBe(true);
  });

  it("rejects FSM-contradicting sequences in collection validation", () => {
    const domain = fullDomain();
    const result = generateBusinessAbuseCases({ domain });
    const sample = { ...result.collection.cases[0]! };
    const badStep = { ...sample.sequence.steps[0]!, stateId: "nonexistent-state-id" };
    sample.sequence = { ...sample.sequence, steps: [badStep] };
    const issues = validateAbuseCase(sample, domain);
    expect(issues.some((i) => i.code === "contradicts_fsm" || i.code === "impossible_transition")).toBe(
      true
    );
  });

  it("deterministic abuse keys across runs", () => {
    const domain = fullDomain();
    const first = generateBusinessAbuseCases({ domain }).collection.cases.map((c) => c.abuseKey).sort();
    const second = generateBusinessAbuseCases({ domain }).collection.cases.map((c) => c.abuseKey).sort();
    expect(second).toEqual(first);
  });

  it("regression: Slice 3 invariant count stable when generating abuse", () => {
    const domain = fullDomain();
    const invariantCount = domain.invariantCollection!.invariants.length;
    generateBusinessAbuseCases({ domain });
    expect(domain.invariantCollection!.invariants.length).toBe(invariantCount);
  });
});
