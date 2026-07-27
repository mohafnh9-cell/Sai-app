import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import { buildBusinessLogicTeamContext } from "../../discovery";
import { buildBusinessDomainModel } from "../../model/build-domain-model";
import { extractBusinessInvariants } from "../../invariants";
import { generateBusinessAbuseCases } from "../../abuse";
import { createBusinessLogicSpecialistRegistry, createDefaultBusinessLogicSpecialists } from "../../registry";
import { buildBusinessLogicSpecialistContext } from "../../specialists/specialist-context";
import { runBusinessLogicSpecialists } from "../../specialists/specialist-runner";
import { BusinessLogicRuntime, BusinessLogicExecutionPlanner } from "../../runtime";
import {
  buildBusinessLogicFindings,
  BusinessLogicFindingValidator,
} from "../index";
import { findingConfidenceFromExecution } from "../finding-severity";
import { hasRuntimeBackedEvidence } from "../finding-correlation";

function richDiscovery(): DiscoveryReport {
  return {
    reportId: "d1",
    projectId: "p1",
    organizationId: "o1",
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "Subscription SaaS with Stripe",
    detectedTechnologies: [],
    authenticationProviders: [],
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
      { area: "admin_area", label: "Admin", rationale: "x", confidence: 0.8 },
    ],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.9,
    cached: false,
  };
}

async function domainWithRuntime() {
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
  domain.specialistExecution = await runBusinessLogicSpecialists({
    registry: createBusinessLogicSpecialistRegistry(createDefaultBusinessLogicSpecialists()),
    context: specialistContext,
  });
  domain.runtimeExecution = await BusinessLogicRuntime.run({ context: specialistContext });
  return domain;
}

describe("RT9 Findings Engine — Slice 7", () => {
  it("runtime produces mock executions linked to abuse hypotheses", async () => {
    const domain = await domainWithRuntime();
    const plans = BusinessLogicExecutionPlanner.planFromSpecialists({
      domain,
      specialistSummary: domain.specialistExecution!,
    });
    expect(plans.some((p) => p.targetAbuseCaseId)).toBe(true);
    expect(
      domain.runtimeExecution!.results.some(
        (r) => r.executionMode === "mock_runtime" && r.status === "completed"
      )
    ).toBe(true);
  });

  it("creates findings only from runtime invariant violations", async () => {
    const domain = await domainWithRuntime();
    const collection = buildBusinessLogicFindings({ domain, businessLogicTeamRunId: "run-bl" });
    expect(collection.findings.length).toBeGreaterThan(0);
    for (const finding of collection.findings) {
      expect(hasRuntimeBackedEvidence(finding.evidence)).toBe(true);
      expect(finding.invariantIds.length).toBeGreaterThan(0);
      expect(finding.workflowId).toBeTruthy();
      expect(finding.replayPlan.sequence.steps.length).toBeGreaterThan(0);
      expect(finding.mitigation.recommendations.length).toBeGreaterThan(0);
    }
  });

  it("merges duplicate findings by workflow and invariant", async () => {
    const domain = await domainWithRuntime();
    const first = buildBusinessLogicFindings({ domain });
    expect(first.findings.length).toBeGreaterThan(0);
    const keys = new Set(first.findings.map((f) => f.findingKey));
    expect(keys.size).toBe(first.findings.length);
  });

  it("propagates confidence from execution classifications", () => {
    const sample = {
      executionId: "e1",
      planId: "p1",
      workflowId: "w1",
      specialistId: "logic.checkout_integrity",
      executionMode: "mock_runtime" as const,
      status: "completed" as const,
      classification: "highly_likely" as const,
      confidence: "highly_likely" as const,
      evidence: [{ id: "1", source: "runtime_mock" as const, detail: "x", confidence: 0.9 }],
      validatedTransitions: [],
      validatedAssumptions: [],
      rejectedAssumptions: [],
      violatedInvariantId: "inv-1",
      businessConsequence: "impact",
      failureReason: null,
      evaluationsUsed: 1,
      transitionsUsed: 0,
      durationMs: 1,
    };
    expect(findingConfidenceFromExecution(sample)).toBe("highly_likely");
  });

  it("calculates business-first severity without CVSS", async () => {
    const domain = await domainWithRuntime();
    const collection = buildBusinessLogicFindings({ domain });
    const finding = collection.findings[0]!;
    expect(["critical", "high", "medium", "low", "informational"]).toContain(finding.severity);
  });

  it("generates replay plans for confirmed and highly likely findings", async () => {
    const domain = await domainWithRuntime();
    const collection = buildBusinessLogicFindings({ domain });
    for (const finding of collection.findings) {
      expect(finding.replayPlan.validationCriteria.length).toBeGreaterThan(0);
      expect(finding.replayPlan.preconditions.length).toBeGreaterThan(0);
      if (finding.confidence === "confirmed" || finding.confidence === "highly_likely") {
        expect(finding.replayPlan.executable).toBe(true);
      }
    }
  });

  it("validates and rejects findings without runtime evidence", () => {
    const domain = { runtimeExecution: { results: [] } } as never;
    void domain;
    const rejected = BusinessLogicFindingValidator.validate({
      findingId: "f1",
      findingKey: "k1",
      title: "t",
      description: "d",
      category: "invariant_violation",
      severity: "low",
      confidence: "likely",
      status: "candidate",
      workflowId: "w1",
      workflowKind: "payment_checkout",
      entityIds: [],
      invariantIds: ["i1"],
      invariantKeys: ["key"],
      transitionIds: [],
      specialistIds: [],
      businessImpact: "x",
      economicImpact: "y",
      replayPlan: {
        id: "rp",
        findingId: "f1",
        preconditions: [],
        sequence: { id: "s", steps: [{ id: "a", order: 1, kind: "assert_invariant", label: "l", transitionId: null, event: null }] },
        expectedOutcome: "o",
        validationCriteria: ["c"],
        evidence: [],
        executable: false,
      },
      mitigation: { summary: "m", recommendations: [{ id: "r", kind: "restore_invariant", statement: "s" }], hintsFromAbuse: [] },
      evidence: [{ id: "e", source: "invariant", detail: "d", confidence: 0.5, refId: null, executionId: null }],
      supportingAssumptions: [],
      executionSummary: "s",
      correlation: {
        keys: [],
        workflowId: "w1",
        invariantId: "i1",
        invariantKey: "key",
        abuseCaseId: null,
        abuseKey: null,
        workflowKind: "payment_checkout",
        businessValueKind: "monetary",
      },
      metadata: {
        businessLogicTeamRunId: null,
        executionId: "e",
        planId: "p",
        specialistId: "s",
        executionMode: "mock_runtime",
        executionClassification: "likely",
        abuseCategory: null,
        generatedAt: new Date().toISOString(),
      },
    });
    expect(rejected.status).toBe("rejected");
  });

  it("regression: slices 1–6 artifacts remain after findings build", async () => {
    const domain = await domainWithRuntime();
    buildBusinessLogicFindings({ domain });
    expect(domain.invariantCollection!.invariants.length).toBeGreaterThan(0);
    expect(domain.abuseCollection!.cases.length).toBeGreaterThan(0);
    expect(domain.specialistExecution!.specialistsCompleted).toBeGreaterThan(0);
    expect(domain.runtimeExecution!.plansCompleted).toBeGreaterThan(0);
  });

  it("deterministic finding keys for identical domain state", async () => {
    const domain = await domainWithRuntime();
    const first = buildBusinessLogicFindings({ domain }).findings.map((f) => f.findingKey).sort();
    const second = buildBusinessLogicFindings({ domain }).findings.map((f) => f.findingKey).sort();
    expect(second).toEqual(first);
  });
});
