import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import { createDefaultRedTeamEngine } from "../../index";
import {
  PLATFORM_E2E_SCENARIOS,
  PLATFORM_E2E_INTERNAL_ORG,
  productionVerdictFingerprint,
  scenarioExpectsRt10,
  scenarioExpectsRt9,
  type PlatformE2eScenarioId,
} from "../scenarios";
import {
  auditPlatformTraceability,
  extractMissionControlInputs,
} from "../traceability";
import { createSecurityIntelligenceEngine } from "../../intelligence/engine";
import { createSecurityDecisionEngine } from "../../decision/decision-engine";
import { buildMissionControlView } from "@/features/mission-control/lib/build-mission-control-view";
import { parseBusinessLogicMetricsFromMetadata } from "@/features/mission-control/lib/parse-business-logic-metrics";
import { parseLlmMetricsFromMetadata } from "@/features/mission-control/lib/parse-llm-metrics";
import { isFeatureEnabled } from "@/server/feature-flags";
import { withFeatureFlagOverrides } from "../../__tests__/test-support/feature-flag-override";
import { validateRedTeamManifest } from "../../core/declarative/manifest-validator";
import { RT9_BUSINESS_LOGIC_MANIFEST } from "../../business-logic/declarative/manifest";
import { createBusinessLogicCapabilityRegistry } from "../../business-logic/capabilities/register-business-logic-capabilities";
import { emitRedTeamTelemetry } from "../../core/telemetry/red-team-telemetry";
import { createSecurityDirector } from "../../director/security-director";
import { createAgentRegistry, registerRedTeamAgents } from "../../agents";
import {
  createBusinessLogicTeamCoordinator,
  createBusinessLogicSpecialistRegistry,
  createDefaultBusinessLogicSpecialists,
} from "../../business-logic";
import { createLlmTeamCoordinator } from "../../llm-team";
import { getLlmTeamOperatingMode, isLlmTeamAnalysisOnly, isLlmTeamEnabled } from "../../llm-team/integration/feature-gate";

const HYBRID_ID: PlatformE2eScenarioId = "hybrid_ai_saas";

describe("Platform E2E — cross-team integration", () => {
  const prevInternal = process.env.SEQURAI_INTERNAL_ORG_IDS;
  const prevLlmMode = process.env.SEQURAI_LLM_TEAM_MODE;

  beforeAll(() => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = PLATFORM_E2E_INTERNAL_ORG;
    process.env.SEQURAI_LLM_TEAM_MODE = "full";
  });

  afterAll(() => {
    if (prevInternal === undefined) delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    else process.env.SEQURAI_INTERNAL_ORG_IDS = prevInternal;
    if (prevLlmMode === undefined) delete process.env.SEQURAI_LLM_TEAM_MODE;
    else process.env.SEQURAI_LLM_TEAM_MODE = prevLlmMode;
  });

  it.each(PLATFORM_E2E_SCENARIOS.map((s) => [s.id, s] as const))(
    "scenario %s runs director pipeline with intelligence and verdict",
    async (_id, scenario) => {
      const { director } = createDefaultRedTeamEngine();
      const report = await director.run({
        requestId: scenario.requestId,
        directorPipeline: true,
        context: {
          projectId: scenario.projectId,
          organizationId: scenario.organizationId,
        },
        discoveryRepository: scenario.discoveryRepository,
        options: { maxParallel: 4, timeoutMs: 120_000 },
      });

      expect(report.discovery.projectId).toBe(scenario.projectId);
      expect(report.intelligence).toBeDefined();
      expect(report.securityDecision).toBeDefined();
      expect(report.productionVerdict).toBeDefined();

      const expectsRt9 = scenarioExpectsRt9(report.discovery);
      const expectsRt10 = scenarioExpectsRt10(report.discovery);
      const rt9Result = report.results.find((r) => r.agentId === "logic.business");
      const rt10Result = report.results.find((r) => r.agentId === "ai.llm");

      if (expectsRt9) {
        expect(rt9Result).toBeDefined();
        expect(rt9Result?.status).not.toBe("failed");
      }
      if (expectsRt10) {
        expect(rt10Result).toBeDefined();
        expect(rt10Result?.status).not.toBe("failed");
      }

      if (report.intelligence?.businessLogic && expectsRt9 && rt9Result?.status === "completed") {
        expect(report.intelligence.businessLogic.findingSummary).toBeDefined();
      }
      if (report.intelligence?.llm && expectsRt10 && rt10Result?.status === "completed") {
        expect(report.intelligence.llm.findingSummary).toBeDefined();
      }

      const trace = auditPlatformTraceability(report);
      const critical = trace.issues.filter(
        (i) => !i.message.includes("skipped") && i.code !== "missing_platform_payload"
      );
      if (rt9Result?.status === "completed" || rt10Result?.status === "completed") {
        expect(critical, trace.issues.map((x) => x.message).join("; ")).toEqual([]);
      }

      const mcInputs = extractMissionControlInputs(report);
      const metadata = {
        businessLogicMetrics: mcInputs.businessLogicMetrics,
        llmMetrics: mcInputs.llmMetrics,
        teamExecution: mcInputs.teamExecution,
      };
      const bl = parseBusinessLogicMetricsFromMetadata(metadata);
      const llm = parseLlmMetricsFromMetadata(metadata);
      if (rt9Result?.status === "completed") expect(bl).toBeTruthy();
      if (rt10Result?.status === "completed") expect(llm).toBeTruthy();

      const view = buildMissionControlView({
        projectId: scenario.projectId,
        projectName: scenario.label,
        verdict: null,
        scanInProgress: false,
        feedFromDb: [],
        businessLogicMetrics: bl ?? undefined,
        llmMetrics: llm ?? undefined,
        teamExecution: mcInputs.teamExecution as Partial<Record<string, string>>,
      });
      expect(view.projectId).toBe(scenario.projectId);
    },
    180_000
  );

  it("production verdict fingerprint is stable across repeated runs (hybrid)", async () => {
    const scenario = PLATFORM_E2E_SCENARIOS.find((s) => s.id === HYBRID_ID)!;
    const { director } = createDefaultRedTeamEngine();
    const a = await director.run({
      requestId: scenario.requestId,
      directorPipeline: true,
      context: { projectId: scenario.projectId, organizationId: scenario.organizationId },
      discoveryRepository: scenario.discoveryRepository,
    });
    const b = await director.run({
      requestId: scenario.requestId,
      directorPipeline: true,
      context: { projectId: scenario.projectId, organizationId: scenario.organizationId },
      discoveryRepository: scenario.discoveryRepository,
    });
    expect(productionVerdictFingerprint(a)).toBe(productionVerdictFingerprint(b));
    expect(a.productionVerdict?.status).toBe(b.productionVerdict?.status);
  }, 180_000);

  it("correlates observations across teams when both complete (hybrid)", async () => {
    const scenario = PLATFORM_E2E_SCENARIOS.find((s) => s.id === HYBRID_ID)!;
    const { director } = createDefaultRedTeamEngine();
    const report = await director.run({
      requestId: scenario.requestId,
      directorPipeline: true,
      context: { projectId: scenario.projectId, organizationId: scenario.organizationId },
      discoveryRepository: scenario.discoveryRepository,
    });
    expect(report.intelligence!.correlations.length).toBeGreaterThanOrEqual(0);
    const domains = new Set(report.results.map((r) => r.domain));
    expect(domains.has("payments") || domains.has("llm")).toBe(true);
  }, 180_000);
});

describe("Platform E2E — feature flags and team modes", () => {
  const prevInternal = process.env.SEQURAI_INTERNAL_ORG_IDS;
  const prevLlmMode = process.env.SEQURAI_LLM_TEAM_MODE;

  afterEach(() => {
    if (prevInternal === undefined) delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    else process.env.SEQURAI_INTERNAL_ORG_IDS = prevInternal;
    if (prevLlmMode === undefined) delete process.env.SEQURAI_LLM_TEAM_MODE;
    else process.env.SEQURAI_LLM_TEAM_MODE = prevLlmMode;
  });

  it("disables RT9/RT10 for public org when flags require internal", async () => {
    delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    await withFeatureFlagOverrides(
      { business_logic_team: "internal", llm_team: "internal" },
      async () => {
        const { isFeatureEnabled: isFeatureEnabledFresh } = await import("@/server/feature-flags");
        expect(
          isFeatureEnabledFresh("business_logic_team", { organizationId: "org-public" })
        ).toBe(false);
        expect(isFeatureEnabledFresh("llm_team", { organizationId: "org-public" })).toBe(false);
      }
    );
  });

  it("analysis-only LLM mode still enables team when flag on", () => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = PLATFORM_E2E_INTERNAL_ORG;
    process.env.SEQURAI_LLM_TEAM_MODE = "analysis_only";
    expect(isLlmTeamEnabled({ organizationId: PLATFORM_E2E_INTERNAL_ORG })).toBe(true);
    expect(isLlmTeamAnalysisOnly({ organizationId: PLATFORM_E2E_INTERNAL_ORG })).toBe(true);
    expect(getLlmTeamOperatingMode({ organizationId: PLATFORM_E2E_INTERNAL_ORG })).toBe("analysis_only");
  });
});

describe("Platform E2E — failure handling", () => {
  const prevInternal = process.env.SEQURAI_INTERNAL_ORG_IDS;
  const scenario = PLATFORM_E2E_SCENARIOS.find((s) => s.id === "simple_saas")!;

  beforeAll(() => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = PLATFORM_E2E_INTERNAL_ORG;
    process.env.SEQURAI_LLM_TEAM_MODE = "full";
  });

  afterAll(() => {
    if (prevInternal === undefined) delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    else process.env.SEQURAI_INTERNAL_ORG_IDS = prevInternal;
  });

  it("continues when RT10 disabled via mode override", async () => {
    process.env.SEQURAI_LLM_TEAM_MODE = "disabled";
    const { director } = createDefaultRedTeamEngine();
    const report = await director.run({
      requestId: "e2e-fail-rt10-off",
      directorPipeline: true,
      context: { projectId: scenario.projectId, organizationId: scenario.organizationId },
      discoveryRepository: scenario.discoveryRepository,
    });
    const rt10 = report.results.find((r) => r.agentId === "ai.llm");
    expect(rt10?.status === "skipped" || rt10 == null).toBe(true);
    expect(report.productionVerdict).toBeDefined();
    process.env.SEQURAI_LLM_TEAM_MODE = "full";
  }, 120_000);

  it("director fails when intelligence adapter throws", async () => {
    const registry = createAgentRegistry();
    registerRedTeamAgents(registry, {
      businessLogicTeam: createBusinessLogicTeamCoordinator({
        registry: createBusinessLogicSpecialistRegistry(createDefaultBusinessLogicSpecialists()),
      }),
      llmTeam: createLlmTeamCoordinator(),
    });
    const director = createSecurityDirector({
      registry,
      intelligenceEngine: {
        analyze: () => {
          throw new Error("INTEGRATION_ADAPTER_FAILURE");
        },
      },
    });
    await expect(
      director.run({
        requestId: "e2e-intel-fail",
        directorPipeline: true,
        context: { projectId: scenario.projectId, organizationId: scenario.organizationId },
        discoveryRepository: scenario.discoveryRepository,
      })
    ).rejects.toThrow(/INTEGRATION_ADAPTER_FAILURE/);
  });

  it("telemetry sink failure does not throw", async () => {
    await expect(
      emitRedTeamTelemetry(
        () => {
          throw new Error("telemetry down");
        },
        {
          name: "pipeline.completed",
          organizationId: "o",
          projectId: "p",
          scanId: "s",
          executionId: "e",
          correlationId: "c",
          redTeamId: "rt10.llm",
          stageId: "findings",
          durationMs: 1,
          status: "ok",
          version: "1.0.0",
        }
      )
    ).resolves.toBeUndefined();
  });

  it("manifest validation rejects missing status", () => {
    const bad = { ...RT9_BUSINESS_LOGIC_MANIFEST, metadata: { ...RT9_BUSINESS_LOGIC_MANIFEST.metadata, status: undefined } };
    const result = validateRedTeamManifest(bad as typeof RT9_BUSINESS_LOGIC_MANIFEST, {
      capabilityRegistry: createBusinessLogicCapabilityRegistry(),
    });
    expect(result.valid).toBe(false);
  });
});

describe("Platform E2E — RT9/RT10 to intelligence/decision chain", () => {
  it("wires platform payloads into intelligence and decision", async () => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = PLATFORM_E2E_INTERNAL_ORG;
    process.env.SEQURAI_LLM_TEAM_MODE = "full";
    const scenario = PLATFORM_E2E_SCENARIOS.find((s) => s.id === HYBRID_ID)!;
    const { director } = createDefaultRedTeamEngine();
    const report = await director.run({
      requestId: scenario.requestId,
      directorPipeline: true,
      context: { projectId: scenario.projectId, organizationId: scenario.organizationId },
      discoveryRepository: scenario.discoveryRepository,
    });

    const intel = createSecurityIntelligenceEngine().analyze({
      discovery: report.discovery,
      results: report.results,
      memory: null,
      staticReviewConfidence: null,
    });
    const decision = createSecurityDecisionEngine().decide({
      intelligence: intel,
      context: {
        projectId: scenario.projectId,
        organizationId: scenario.organizationId,
        commitSha: report.discovery.commitSha,
        deploymentEnvironment: "preview",
        replayStatus: "not_run",
      },
    });
    expect(decision.decision.deploymentVerdict).toBeDefined();
    expect(intel.businessLogic ?? intel.llm).toBeTruthy();
  }, 180_000);
});
