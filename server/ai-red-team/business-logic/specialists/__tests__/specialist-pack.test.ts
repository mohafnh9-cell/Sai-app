import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import { buildBusinessLogicTeamContext } from "../../discovery";
import { buildBusinessDomainModel } from "../../model/build-domain-model";
import { extractBusinessInvariants } from "../../invariants";
import { generateBusinessAbuseCases } from "../../abuse";
import {
  createBusinessLogicSpecialistRegistry,
  createDefaultBusinessLogicSpecialists,
} from "../../registry";
import { buildBusinessLogicSpecialistContext } from "../specialist-context";
import { runBusinessLogicSpecialists } from "../specialist-runner";
import { CheckoutIntegritySpecialist } from "../checkout-integrity-specialist";
import type {
  BusinessLogicSpecialistContext,
  BusinessLogicSpecialistPlan,
} from "../specialist.types";
import { BUSINESS_LOGIC_SPECIALIST_MAX_VALIDATION_STEPS } from "../specialist.types";

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

function specialistContext() {
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
  return buildBusinessLogicSpecialistContext(teamContext)!;
}

class BrokenSpecialist extends CheckoutIntegritySpecialist {
  override readonly id = "logic.broken_test";
  override readonly priority = 5;

  override async analyze(
    _context: BusinessLogicSpecialistContext,
    _plan: BusinessLogicSpecialistPlan
  ): Promise<{ observations: [] }> {
    throw new Error("simulated specialist failure");
  }
}

describe("RT9 Specialist Pack V1 — Slice 5", () => {
  it("registry lists default specialists by priority", () => {
    const registry = createBusinessLogicSpecialistRegistry(createDefaultBusinessLogicSpecialists());
    const ids = registry.listAll().map((s) => s.id);
    expect(ids[0]).toBe("logic.checkout_integrity");
    expect(ids.length).toBe(5);
  });

  it("checkout specialist plans from invariants and abuse only", async () => {
    const context = specialistContext();
    const specialist = new CheckoutIntegritySpecialist();
    const eligibility = await specialist.canRun(context);
    expect(eligibility.eligible).toBe(true);
    const plan = await specialist.plan(context);
    expect(plan.workflowIds.length).toBeGreaterThan(0);
    expect(plan.invariantIds.length).toBeGreaterThan(0);
    expect(plan.boundedStepCount).toBeLessThanOrEqual(BUSINESS_LOGIC_SPECIALIST_MAX_VALIDATION_STEPS);
    const analyzed = await specialist.analyze(context, plan);
    expect(analyzed.observations.some((o) => o.kind === "checkout_integrity")).toBe(true);
  });

  it("fail-isolated runner continues when one specialist throws", async () => {
    const context = specialistContext();
    const registry = createBusinessLogicSpecialistRegistry([
      new BrokenSpecialist(),
      ...createDefaultBusinessLogicSpecialists(),
    ]);

    const summary = await runBusinessLogicSpecialists({ registry, context });
    expect(summary.specialistsFailed).toBe(1);
    expect(summary.specialistsCompleted).toBeGreaterThan(0);
    expect(
      summary.results.some(
        (r) => r.specialistId === "logic.checkout_integrity" && r.status === "completed"
      )
    ).toBe(true);
  });

  it("skips specialists without matching workflows", async () => {
    const minimal = buildBusinessLogicTeamContext({
      businessLogicTeamRunId: "run-bl",
      redTeamRunId: "rt-1",
      organizationId: "o1",
      projectId: "p1",
      discovery: {
        ...richDiscovery(),
        potentialAttackSurface: [{ area: "payments", label: "Pay", rationale: "x", confidence: 0.9 }],
        projectSummary: "Payments only",
      },
      plan: { planId: "plan", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });
    const domain = buildBusinessDomainModel(minimal);
    domain.invariantCollection = extractBusinessInvariants({
      domain,
      discoverySignals: minimal.signals,
    });
    domain.abuseCollection = generateBusinessAbuseCases({ domain }).collection;
    minimal.domainModel = domain;
    const context = buildBusinessLogicSpecialistContext(minimal)!;

    const summary = await runBusinessLogicSpecialists({
      registry: createBusinessLogicSpecialistRegistry(createDefaultBusinessLogicSpecialists()),
      context,
    });
    expect(summary.specialistsSkipped).toBeGreaterThan(0);
    expect(summary.specialistsCompleted).toBeGreaterThan(0);
  });

  it("observations preserve evidence and abuse traceability", async () => {
    const context = specialistContext();
    const specialist = new CheckoutIntegritySpecialist();
    const plan = await specialist.plan(context);
    const { observations } = await specialist.analyze(context, plan);
    const withEvidence = observations.filter((o) => o.evidenceRefIds.length > 0);
    expect(withEvidence.length).toBeGreaterThan(0);
    for (const obs of observations) {
      expect(obs.specialistId).toBe(specialist.id);
    }
  });
});
