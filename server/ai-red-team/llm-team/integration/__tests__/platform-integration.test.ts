import { afterAll, describe, expect, it } from "vitest";
import type { AttackResult } from "../../../types";
import { createLlmTeamCoordinator } from "../../coordinator";
import { LlmTeamAgent } from "../../llm-team-agent";
import { buildLlmPlatformPayload } from "../platform-payload";
import {
  extractLlmIntelligenceFromResults,
  buildLlmUeeRemediationInputs,
  collectLlmReplayPlansFromResult,
  readCanonicalAttackPreconditionsFromResult,
} from "../platform-bridge";
import { createSecurityIntelligenceEngine } from "../../../intelligence/engine";
import { createSecurityDecisionEngine } from "../../../decision/decision-engine";
import { isFeatureEnabled } from "@/server/feature-flags";
import type { DiscoveryReport } from "../../../discovery/types";
import { planLlmOrchestrationMetadata } from "../../../autonomous-orchestrator/llm-orchestration";
import {
  mergeLlmTeamExecutionFromMetadata,
  parseLlmMetricsFromMetadata,
} from "@/features/mission-control/lib/parse-llm-metrics";
import { buildMissionControlView } from "@/features/mission-control/lib/build-mission-control-view";
import { getLlmTeamOperatingMode } from "../feature-gate";
import { runRt10FindingsPipeline } from "../../pipeline/rt10-coordinator";

const INTERNAL_ORG = "org-internal-rt10";

function aiDiscovery(): DiscoveryReport {
  return {
    reportId: "d-rt10",
    projectId: "p1",
    organizationId: INTERNAL_ORG,
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "AI SaaS with RAG, LangChain agents, and MCP tools.",
    detectedTechnologies: [
      { id: "lc", name: "LangChain", category: "ai", confidence: 0.9, evidence: ["package.json"] },
      { id: "sdk", name: "Vercel AI SDK", category: "library", confidence: 0.88, evidence: ["package.json"] },
    ],
    authenticationProviders: [],
    database: [],
    payments: [],
    aiProviders: [{ id: "openai", name: "OpenAI", category: "ai", confidence: 0.95, evidence: ["sdk"] }],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: ["npm"],
    potentialAttackSurface: [
      { area: "llm", label: "Chat API", rationale: "LLM routes", confidence: 0.9 },
      { area: "mcp_servers", label: "MCP", rationale: "Tools", confidence: 0.85 },
    ],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.9,
    cached: false,
  };
}

describe("RT10 Platform Integration — Slice 8", () => {
  const prev = process.env.SEQURAI_INTERNAL_ORG_IDS;
  const prevMode = process.env.SEQURAI_LLM_TEAM_MODE;
  process.env.SEQURAI_INTERNAL_ORG_IDS = INTERNAL_ORG;

  it("agent emits AttackFindings and platform payload", async () => {
    const agent = new LlmTeamAgent(createLlmTeamCoordinator());
    const discovery = aiDiscovery();
    const plan = { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] };
    const attack = await agent.execute({
      requestId: "req-1",
      signal: undefined,
      context: {
        organizationId: INTERNAL_ORG,
        projectId: "proj",
        declaredCapabilities: ["llm"],
        metadata: { llmAttack: { discovery, plan } },
      },
    });
    expect(attack.metadata?.llmPlatform).toBeTruthy();
    expect(attack.metadata?.replayPlans).toBeTruthy();
    expect(attack.metadata?.teamExecution).toEqual({ llm: "completed" });
    for (const f of attack.findings) {
      expect(f.domain).toBe("llm");
      expect(f.metadata?.team).toBe("llm");
      expect(f.metadata?.ueeRemediation).toBeTruthy();
    }
  });

  it("RT4 intelligence includes LLM bundle", async () => {
    const coordinator = createLlmTeamCoordinator();
    const result = await coordinator.run({
      organizationId: INTERNAL_ORG,
      projectId: "p",
      runId: "r",
      requestId: "req",
      discoveryReport: aiDiscovery(),
      plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });
    const platform = buildLlmPlatformPayload(result);
    const attackResult: AttackResult = {
      agentId: "ai.llm",
      agentName: "LLM Team",
      domain: "llm",
      status: "completed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1,
      findings: [],
      evidence: [],
      logs: [],
      metadata: { llmPlatform: platform },
    };
    const intel = createSecurityIntelligenceEngine().analyze({
      discovery: aiDiscovery(),
      results: [attackResult],
    });
    expect(intel.llm?.findingSummary.total).toBe(result.findingsCount);
    expect(intel.verdict.coverage.some((c) => c.includes("AI / LLM"))).toBe(true);
  });

  it("RT5 consumes LLM decision exposure via intelligence", async () => {
    const agent = new LlmTeamAgent(createLlmTeamCoordinator());
    const discovery = aiDiscovery();
    const plan = { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] };
    const attack = await agent.execute({
      requestId: "req-2",
      signal: undefined,
      context: {
        organizationId: INTERNAL_ORG,
        projectId: "proj",
        declaredCapabilities: ["llm"],
        metadata: { llmAttack: { discovery, plan } },
      },
    });
    const intel = createSecurityIntelligenceEngine().analyze({
      discovery,
      results: [attack],
    });
    expect(intel.llm?.decisionExposure).toBeTruthy();
    const decision = createSecurityDecisionEngine().decide({
      intelligence: intel,
      context: {
        projectId: "proj",
        commitSha: "abc",
        deploymentEnvironment: "production",
        acceptedRisks: [],
        safeFixStatus: "not_run",
        replayStatus: "not_run",
        redTeamRunStatus: "completed",
      },
    });
    expect(decision.decision.metadata?.llmDecisionExposure).toBeTruthy();
  });

  it("UEE remediation inputs exposed on attack result", async () => {
    const agent = new LlmTeamAgent(createLlmTeamCoordinator());
    const attack = await agent.execute({
      requestId: "req-3",
      signal: undefined,
      context: {
        organizationId: INTERNAL_ORG,
        projectId: "proj",
        declaredCapabilities: ["llm"],
        metadata: {
          llmAttack: {
            discovery: aiDiscovery(),
            plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
          },
        },
      },
    });
    const inputs = buildLlmUeeRemediationInputs(attack.metadata?.llmPlatform as never);
    expect(inputs.length).toBe(attack.findings.length);
    if (inputs[0]) {
      expect(inputs[0].replayPreconditions).toBeTruthy();
      expect(inputs[0].expectedValidationCriteria).toBeTruthy();
    }
  });

  it("ASO orchestration metadata is non-executing", () => {
    const hints = planLlmOrchestrationMetadata({
      discovery: aiDiscovery(),
      llmEnabled: true,
    });
    expect(hints?.autoExecute).toBe(false);
    expect(hints?.supportedOperations).toContain("prompt_validation");
  });

  it("Mission Control parses LLM metrics", () => {
    const metrics = {
      aiComponents: 4,
      executionGraphNodes: 12,
      executionGraphEdges: 10,
      trustBoundaries: 2,
      trustInvariants: 5,
      attackCases: 3,
      executedSpecialists: 2,
      runtimeExecutions: 2,
      replayPlans: 1,
      protectedAssets: 6,
      attackPreconditions: 1,
      coveragePercent: 83,
      executionDurationMs: 120,
      failureCount: 0,
      skippedSpecialists: 1,
      runtimeBudgetMs: 60_000,
      executionMode: "full",
      analysisPhase: "RT10_FINDINGS_V1",
      findingsCount: 1,
      confidenceBand: "high" as const,
    };
    const parsed = parseLlmMetricsFromMetadata({ llmMetrics: metrics });
    expect(parsed?.findingsCount).toBe(1);
    const view = buildMissionControlView({
      projectId: "p",
      projectName: "P",
      verdict: null,
      scanInProgress: false,
      detectedStack: { ai: "openai" },
      feedFromDb: [],
      teamExecution: { llm: "completed" },
      llmMetrics: metrics,
    });
    const llmTeam = view.teams.find((t) => t.id === "llm")!;
    expect(llmTeam.progressPercent).toBe(83);
  });

  it("feature flag disables agent canRun", async () => {
    const agent = new LlmTeamAgent(createLlmTeamCoordinator());
    const enabled = await agent.canRun({
      projectId: "p",
      organizationId: "org-public",
      declaredCapabilities: ["llm"],
      metadata: {
        llmAttack: {
          discovery: aiDiscovery(),
          plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
        },
      },
    });
    expect(enabled).toBe(false);
    expect(isFeatureEnabled("llm_team", { organizationId: "org-public" })).toBe(false);
  });

  it("attack preconditions propagate without recomputation", async () => {
    const agent = new LlmTeamAgent(createLlmTeamCoordinator());
    const attack = await agent.execute({
      requestId: "req-4",
      signal: undefined,
      context: {
        organizationId: INTERNAL_ORG,
        projectId: "proj",
        declaredCapabilities: ["llm"],
        metadata: {
          llmAttack: {
            discovery: aiDiscovery(),
            plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
          },
        },
      },
    });
    const canonical = readCanonicalAttackPreconditionsFromResult(attack);
    expect(canonical?.records.length).toBe(attack.findings.length);
    for (const f of attack.findings) {
      const record = canonical?.records.find((r) => r.findingId === f.id);
      expect(record?.preconditions.requiredAttackerCapability).toBe(
        (f.metadata?.ueeRemediation as { replayPreconditions: { requiredAttackerCapability: string } })
          .replayPreconditions.requiredAttackerCapability
      );
    }
  });

  it("protected assets summary on platform payload", async () => {
    const agent = new LlmTeamAgent(createLlmTeamCoordinator());
    const attack = await agent.execute({
      requestId: "req-5",
      signal: undefined,
      context: {
        organizationId: INTERNAL_ORG,
        projectId: "proj",
        declaredCapabilities: ["llm"],
        metadata: {
          llmAttack: {
            discovery: aiDiscovery(),
            plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
          },
        },
      },
    });
    const summary = attack.metadata?.protectedAssetSummary as { totalAssets: number };
    expect(summary.totalAssets).toBeGreaterThan(0);
  });

  it("replay plans collected for fix strategy bridge", async () => {
    const agent = new LlmTeamAgent(createLlmTeamCoordinator());
    const attack = await agent.execute({
      requestId: "req-6",
      signal: undefined,
      context: {
        organizationId: INTERNAL_ORG,
        projectId: "proj",
        declaredCapabilities: ["llm"],
        metadata: {
          llmAttack: {
            discovery: aiDiscovery(),
            plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
          },
        },
      },
    });
    const plans = collectLlmReplayPlansFromResult(attack);
    expect(plans.length).toBe(attack.findings.length);
  });

  it("Slice 7 findings pipeline regression", async () => {
    const pipeline = await runRt10FindingsPipeline(aiDiscovery());
    expect(pipeline.findings.findings.length).toBeGreaterThan(0);
  });

  it("analysis-only mode via env", () => {
    process.env.SEQURAI_LLM_TEAM_MODE = "analysis_only";
    expect(getLlmTeamOperatingMode({ organizationId: INTERNAL_ORG })).toBe("analysis_only");
  });

  it("extractLlmIntelligenceFromResults returns null when team absent", () => {
    expect(extractLlmIntelligenceFromResults([])).toBeNull();
  });

  it("mergeLlmTeamExecutionFromMetadata reads teamExecution.llm", () => {
    expect(mergeLlmTeamExecutionFromMetadata({ teamExecution: { llm: "completed" } })).toEqual({
      llm: "completed",
    });
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    else process.env.SEQURAI_INTERNAL_ORG_IDS = prev;
    if (prevMode === undefined) delete process.env.SEQURAI_LLM_TEAM_MODE;
    else process.env.SEQURAI_LLM_TEAM_MODE = prevMode;
  });
});
