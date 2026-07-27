import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { DiscoveryReport } from "../../discovery/types";
import { createAgentRegistry, registerRedTeamAgents } from "../../agents";
import { createAttackOrchestrator } from "../../execution/attack-orchestrator";
import { createAttackPlanner } from "../../execution/attack-planner";
import { isFeatureEnabled } from "@/server/feature-flags";
import {
  BusinessLogicTeamAgent,
  createBusinessLogicTeamCoordinator,
  BUSINESS_LOGIC_PIPELINE_COMPLETE_DEFERRAL,
} from "../index";
import { createDefaultRedTeamEngine } from "../../index";

const INTERNAL_ORG = "org-internal-rt9";

function discovery(overrides?: Partial<DiscoveryReport>): DiscoveryReport {
  return {
    reportId: "d1",
    projectId: "project-1",
    organizationId: INTERNAL_ORG,
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "SaaS with billing",
    detectedTechnologies: [],
    authenticationProviders: [],
    database: [],
    payments: [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.9, evidence: [] }],
    aiProviders: [],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: [],
    potentialAttackSurface: [
      { area: "payments", label: "Payments", rationale: "Stripe", confidence: 0.9 },
    ],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.85,
    cached: false,
    ...overrides,
  };
}

const emptyPlan = {
  planId: "plan",
  createdAt: new Date().toISOString(),
  phases: [],
  notes: [],
};

describe("RT9 Business Logic Team — Phase 1", () => {
  const prevInternal = process.env.SEQURAI_INTERNAL_ORG_IDS;

  beforeEach(() => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = INTERNAL_ORG;
  });

  afterEach(() => {
    if (prevInternal === undefined) delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    else process.env.SEQURAI_INTERNAL_ORG_IDS = prevInternal;
  });

  it("registers agent in default red team engine (same as RT7/RT8)", () => {
    const { registry } = createDefaultRedTeamEngine();
    expect(registry.getById("logic.business")).not.toBeNull();
  });

  it("feature flag disables canRun for non-internal organizations", async () => {
    const agent = new BusinessLogicTeamAgent(createBusinessLogicTeamCoordinator());
    const enabled = await agent.canRun({
      projectId: "p",
      organizationId: "org-public",
      declaredCapabilities: ["payments"],
      metadata: {
        businessLogicAttack: { discovery: discovery(), plan: emptyPlan },
      },
    });
    expect(enabled).toBe(false);
    expect(
      isFeatureEnabled("business_logic_team", { organizationId: "org-public" })
    ).toBe(false);
  });

  it("coordinator completes RT9 pipeline with finding collection", async () => {
    const result = await createBusinessLogicTeamCoordinator().run({
      organizationId: INTERNAL_ORG,
      projectId: "p",
      runId: "run-1",
      requestId: "req-1",
      discoveryReport: discovery(),
      plan: emptyPlan,
    });
    expect(result.findingsCount).toBeGreaterThanOrEqual(0);
    expect(result.workflowsDiscovered).toBeGreaterThan(0);
    expect(result.status).toBe("completed");
    expect(result.skippedReason).toBeUndefined();
    expect(result.executionMode).toBe("analysis");
    expect(result.context?.workflows.length).toBe(result.workflowsDiscovered);
    expect(result.deferralReason).toBe(BUSINESS_LOGIC_PIPELINE_COMPLETE_DEFERRAL);
    expect(result.analysisPhase).toBe("RT9_FINDINGS_COMPLETE");
    expect(result.invariantsExtracted).toBeGreaterThan(0);
    expect(result.abuseHypothesesGenerated).toBeGreaterThan(0);
    expect(result.specialistObservationsGenerated).toBeGreaterThan(0);
    expect(result.specialistsCompleted).toBeGreaterThan(0);
    expect(result.runtimeExecutionsCompleted).toBeGreaterThan(0);
    expect(result.context?.domainModel?.findingCollection).toBeDefined();
    expect(result.context?.domainModel?.runtimeExecution?.results.length).toBeGreaterThan(0);
    expect(result.context?.domainModel?.invariantCollection?.invariants.length).toBe(
      result.invariantsExtracted
    );
  });

  it("orchestrator executes Business Logic agent with businessLogicAttack context", async () => {
    const registry = createAgentRegistry();
    registerRedTeamAgents(registry, {
      businessLogicTeam: createBusinessLogicTeamCoordinator(),
    });
    const disc = discovery();
    const plan = createAttackPlanner().createPlan({
      context: {
        projectId: "p",
        organizationId: INTERNAL_ORG,
        declaredCapabilities: ["payments"],
        metadata: {
          businessLogicAttack: {
            discovery: disc,
            plan: emptyPlan,
            redTeamRunId: "run-1",
          },
        },
      },
      scope: ["payments"],
    });

    const { results } = await createAttackOrchestrator().execute({
      requestId: "req-1",
      context: {
        projectId: "p",
        organizationId: INTERNAL_ORG,
        declaredCapabilities: ["payments"],
        metadata: {
          businessLogicAttack: {
            discovery: disc,
            plan,
            redTeamRunId: "run-1",
          },
        },
      },
      plan,
      registry,
    });

    const bl = results.find((r) => r.agentId === "logic.business");
    expect(bl?.status).toBe("completed");
    expect(bl?.findings.length).toBeGreaterThanOrEqual(0);
    expect(bl?.evidence.some((e) => e.kind === "business_logic_team_summary")).toBe(true);
    expect(bl?.metadata?.deferralReason).toBe(BUSINESS_LOGIC_PIPELINE_COMPLETE_DEFERRAL);
    expect(bl?.metadata?.invariantsExtracted).toBeGreaterThan(0);
    expect(bl?.metadata?.executionMode).toBe("analysis");
    expect(bl?.metadata?.workflowsDiscovered).toBeGreaterThan(0);
  });
});
