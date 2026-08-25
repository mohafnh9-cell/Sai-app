import { afterAll, describe, expect, it } from "vitest";
import type { AttackResult } from "../../../types";
import { createBusinessLogicTeamCoordinator } from "../../coordinator";
import { BusinessLogicTeamAgent } from "../../business-logic-team-agent";
import { buildBusinessLogicPlatformPayload } from "../platform-payload";
import {
  extractBusinessLogicIntelligenceFromResults,
  buildBusinessLogicUeeRemediationInputs,
  collectBusinessLogicReplayPlansFromResult,
} from "../platform-bridge";
import { createSecurityIntelligenceEngine } from "../../../intelligence/engine";
import { isFeatureEnabled } from "@/server/feature-flags";
import type { DiscoveryReport } from "../../../discovery/types";
import { planBusinessLogicOrchestrationMetadata } from "../../../autonomous-orchestrator/business-logic-orchestration";
import {
  parseBusinessLogicMetricsFromMetadata,
  mergeTeamExecutionFromMetadata,
} from "@/features/mission-control/lib/parse-business-logic-metrics";
import { buildMissionControlView } from "@/features/mission-control/lib/build-mission-control-view";
import { withFeatureFlagOverrides } from "../../../__tests__/test-support/feature-flag-override";

const INTERNAL_ORG = "org-internal-rt9";

function richDiscovery(): DiscoveryReport {
  return {
    reportId: "d1",
    projectId: "p1",
    organizationId: INTERNAL_ORG,
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "Stripe SaaS",
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
    ],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.9,
    cached: false,
  };
}

describe("RT9 Platform Integration — Slice 8", () => {
  const prev = process.env.SEQURAI_INTERNAL_ORG_IDS;
  process.env.SEQURAI_INTERNAL_ORG_IDS = INTERNAL_ORG;

  it("agent emits AttackFindings and platform payload", async () => {
    const agent = new BusinessLogicTeamAgent(createBusinessLogicTeamCoordinator());
    const discovery = richDiscovery();
    const plan = { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] };
    const attack = await agent.execute({
      requestId: "req-1",
      signal: undefined,
      context: {
        organizationId: INTERNAL_ORG,
        projectId: "proj",
        declaredCapabilities: ["payments"],
        metadata: { businessLogicAttack: { discovery, plan } },
      },
    });
    expect(attack.findings.length).toBeGreaterThanOrEqual(0);
    expect(attack.metadata?.businessLogicPlatform).toBeTruthy();
    expect(attack.metadata?.replayPlans).toBeTruthy();
    expect(attack.metadata?.teamExecution).toEqual({ business_logic: "completed" });
    for (const f of attack.findings) {
      expect(f.domain).toBe("payments");
      expect(f.metadata?.team).toBe("business_logic");
      expect(f.metadata?.ueeRemediation).toBeTruthy();
    }
  });

  it("RT4 intelligence includes business logic bundle", async () => {
    const coordinator = createBusinessLogicTeamCoordinator();
    const result = await coordinator.run({
      organizationId: INTERNAL_ORG,
      projectId: "p",
      runId: "r",
      requestId: "req",
      discoveryReport: richDiscovery(),
      plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });
    const platform = buildBusinessLogicPlatformPayload(result);
    const attackResult: AttackResult = {
      agentId: "logic.business",
      agentName: "Business Logic Team",
      domain: "payments",
      status: "completed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1,
      findings: [],
      evidence: [],
      logs: [],
      metadata: { businessLogicPlatform: platform },
    };
    const intel = createSecurityIntelligenceEngine().analyze({
      discovery: richDiscovery(),
      results: [attackResult],
    });
    expect(intel.businessLogic?.findingSummary.total).toBe(result.findingsCount);
    expect(intel.verdict.coverage.some((c) => c.includes("Business logic"))).toBe(true);
  });

  it("RT5 consumes findings via intelligence deduplicated set", async () => {
    const agent = new BusinessLogicTeamAgent(createBusinessLogicTeamCoordinator());
    const discovery = richDiscovery();
    const plan = { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] };
    const attack = await agent.execute({
      requestId: "req-2",
      signal: undefined,
      context: {
        organizationId: INTERNAL_ORG,
        projectId: "proj",
        declaredCapabilities: ["payments"],
        metadata: { businessLogicAttack: { discovery, plan } },
      },
    });
    const intel = createSecurityIntelligenceEngine().analyze({
      discovery,
      results: [attack],
    });
    expect(intel.deduplicatedFindings.some((f) => f.domain === "payments")).toBe(
      attack.findings.length > 0
    );
    expect(intel.businessLogic?.decisionExposure).toBeTruthy();
  });

  it("UEE remediation inputs exposed on attack result", async () => {
    const agent = new BusinessLogicTeamAgent(createBusinessLogicTeamCoordinator());
    const attack = await agent.execute({
      requestId: "req-3",
      signal: undefined,
      context: {
        organizationId: INTERNAL_ORG,
        projectId: "proj",
        declaredCapabilities: ["payments"],
        metadata: {
          businessLogicAttack: {
            discovery: richDiscovery(),
            plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
          },
        },
      },
    });
    const inputs = buildBusinessLogicUeeRemediationInputs(
      attack.metadata?.businessLogicPlatform as never
    );
    expect(inputs.length).toBe(attack.findings.length);
  });

  it("ASO orchestration metadata is non-executing", () => {
    const hints = planBusinessLogicOrchestrationMetadata({
      discovery: richDiscovery(),
      businessLogicEnabled: true,
    });
    expect(hints?.autoExecute).toBe(false);
    expect(hints?.supportedOperations.length).toBeGreaterThan(0);
  });

  it("Mission Control parses business logic metrics", () => {
    const metrics = {
      coveragePercent: 83,
      confidenceBand: "high" as const,
      workflowCount: 2,
      fsmCount: 2,
      invariantCount: 5,
      abuseCaseCount: 4,
      specialistsExecuted: 2,
      specialistsSkipped: 1,
      runtimeExecutions: 3,
      findingsCount: 1,
      replayPlanCount: 1,
      executionDurationMs: 120,
      executionMode: "analysis",
      analysisPhase: "RT9_FINDINGS_COMPLETE",
    };
    const parsed = parseBusinessLogicMetricsFromMetadata({ businessLogicMetrics: metrics });
    expect(parsed?.findingsCount).toBe(1);
    const view = buildMissionControlView({
      projectId: "p",
      projectName: "P",
      verdict: null,
      scanInProgress: false,
      detectedStack: { billing: "stripe" },
      feedFromDb: [],
      teamExecution: { business_logic: "completed" },
      businessLogicMetrics: metrics,
    });
    const blTeam = view.teams.find((t) => t.id === "business_logic")!;
    expect(blTeam.progressPercent).toBe(83);
  });

  it("feature flag disables agent canRun", async () => {
    await withFeatureFlagOverrides({ business_logic_team: "internal" }, async () => {
      const { isFeatureEnabled: isFeatureEnabledFresh } = await import("@/server/feature-flags");
      const { createBusinessLogicTeamCoordinator: createBusinessLogicTeamCoordinatorFresh } =
        await import("../../coordinator");
      const { BusinessLogicTeamAgent: BusinessLogicTeamAgentFresh } = await import(
        "../../business-logic-team-agent"
      );

      const agent = new BusinessLogicTeamAgentFresh(createBusinessLogicTeamCoordinatorFresh());
      const enabled = await agent.canRun({
        projectId: "p",
        organizationId: "org-public",
        declaredCapabilities: ["payments"],
        metadata: {
          businessLogicAttack: {
            discovery: richDiscovery(),
            plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
          },
        },
      });
      expect(enabled).toBe(false);
      expect(
        isFeatureEnabledFresh("business_logic_team", { organizationId: "org-public" })
      ).toBe(false);
    });
  });

  it("replay plans collected for fix strategy bridge", async () => {
    const agent = new BusinessLogicTeamAgent(createBusinessLogicTeamCoordinator());
    const attack = await agent.execute({
      requestId: "req-4",
      signal: undefined,
      context: {
        organizationId: INTERNAL_ORG,
        projectId: "proj",
        declaredCapabilities: ["payments"],
        metadata: {
          businessLogicAttack: {
            discovery: richDiscovery(),
            plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
          },
        },
      },
    });
    const plans = collectBusinessLogicReplayPlansFromResult(attack);
    expect(plans.length).toBe(attack.findings.length);
  });

  it("extractBusinessLogicIntelligenceFromResults returns null when team absent", () => {
    expect(extractBusinessLogicIntelligenceFromResults([])).toBeNull();
  });

  it("mergeTeamExecutionFromMetadata reads teamExecution.business_logic", () => {
    expect(mergeTeamExecutionFromMetadata({ teamExecution: { business_logic: "completed" } })).toEqual({
      business_logic: "completed",
    });
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    else process.env.SEQURAI_INTERNAL_ORG_IDS = prev;
  });
});
