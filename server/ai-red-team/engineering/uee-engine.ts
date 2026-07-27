import { randomUUID } from "node:crypto";
import { createRedTeamLogger } from "../logging/red-team-logger";
import type {
  UniversalEngineeringEngineInput,
  UniversalEngineeringEngineResult,
  AdapterOutput,
  PreferredAI,
} from "./uee.types";
import { buildAttackCampaignFromIntelligence } from "../fix-strategy/campaign/attack-campaign";
import {
  analyzeRootCauses,
  assignUnmappedFindings,
  dedupeRootCauses,
} from "../fix-strategy/root-cause/root-cause-engine";
import { buildGroupedFixes, mergeFixesWithSharedSolution } from "../fix-strategy/strategy/grouped-fix-builder";
import { buildArchitectureContext } from "../fix-strategy/architecture/architecture-context";
import { generateRegressionTests } from "../fix-strategy/regression/regression-generator";
import {
  collectReplayPlansFromResults,
  mapFindingToReplayIds,
  shouldGenerateAlternateStrategy,
} from "../fix-strategy/replay/replay-fix-bridge";
import { buildUniversalEngineeringPlan } from "./planner/engineering-planner";
import { buildVerificationEngineeringPlan } from "./verification/verification-plan-builder";
import {
  ALL_AI_ADAPTERS,
  getAdapter,
  renderVerificationPrompt,
  type AiAdapterContext,
} from "./adapters/ai-adapters";
import { resolvePreferredAI } from "./detection/preferred-ai";
import {
  engineeringPlanToJson,
  engineeringPlanToMarkdown,
  engineeringPlanToMcpResponse,
  engineeringPlanToRestResponse,
  engineeringPlanToYaml,
} from "./serialization/plan-serializers";
import { isFeatureEnabled } from "@/server/feature-flags";
import {
  buildBusinessLogicUeeRemediationInputs,
  readBusinessLogicPlatformPayload,
} from "../business-logic/integration/platform-bridge";
import {
  buildLlmUeeRemediationInputs,
  readLlmPlatformPayload,
} from "../llm-team/integration/platform-bridge";

export class UniversalEngineeringEngine {
  constructor(private readonly logger = createRedTeamLogger()) {}

  run(input: UniversalEngineeringEngineInput): UniversalEngineeringEngineResult {
    const startedAt = Date.now();
    const replayStatus = input.replayStatus ?? "not_run";
    const planVersion =
      (input.previousPlanVersion ?? 1) + (shouldGenerateAlternateStrategy(replayStatus) ? 1 : 0);

    const campaign = buildAttackCampaignFromIntelligence(input.intelligence);
    const findings = input.intelligence.deduplicatedFindings;

    let rootCauses = dedupeRootCauses(analyzeRootCauses(findings));
    rootCauses = assignUnmappedFindings(rootCauses, campaign.findingIds);

    const replayPlans = collectReplayPlansFromResults(input.results);
    const replayPlanIdsByFinding = mapFindingToReplayIds(replayPlans);
    const replayPlanIds = [...new Set(replayPlans.map((p) => p.replayPlanId))];

    let groupedFixes = buildGroupedFixes({
      rootCauses,
      findings,
      priorities: input.intelligence.priorities,
      discoverySummary: input.discovery.projectSummary,
      replayPlanIdsByFinding,
    });
    groupedFixes = mergeFixesWithSharedSolution(groupedFixes);

    if (shouldGenerateAlternateStrategy(replayStatus) && planVersion > 1) {
      groupedFixes = groupedFixes.map((fix) => ({
        ...fix,
        recommendedVariant: fix.recommendedVariant === "quick_fix" ? "production_fix" : "best_practice",
        summary: `${fix.summary} (revised plan after failed replay)`,
      }));
    }

    const { notes, preserve } = buildArchitectureContext(input.discovery);
    const planId = randomUUID();
    const regressionTests = generateRegressionTests({ groupedFixes, findings });

    const plan = buildUniversalEngineeringPlan({
      campaign,
      rootCauses,
      groupedFixes,
      discovery: input.discovery,
      architectureNotes: notes,
      preserveRules: preserve,
      regressionTests,
      replayPlanIds,
      replayStatus,
      planVersion,
      planId,
    });

    const verificationPlan = buildVerificationEngineeringPlan(plan);
    const adapterContext: AiAdapterContext = {
      projectSummary: input.discovery.projectSummary,
      plan,
      verificationPlan,
    };

    const adaptersEnabled = isFeatureEnabled("ai_adapters", {
      organizationId: input.organizationId,
    });
    const verificationEnabled = isFeatureEnabled("verification_engine", {
      organizationId: input.organizationId,
    });

    const preferred = resolvePreferredAI({ preferredAI: input.preferredAI });
    const adapterOutputs: AdapterOutput[] = [];

    const pushTimed = (output: Omit<AdapterOutput, "generationTimeMs">) => {
      adapterOutputs.push({ ...output, generationTimeMs: Date.now() - startedAt });
    };

    pushTimed(engineeringPlanToJson(plan));
    pushTimed(engineeringPlanToMarkdown(plan));
    pushTimed(engineeringPlanToYaml(plan));
    pushTimed(engineeringPlanToRestResponse({ plan, verificationPlan }));
    pushTimed(
      engineeringPlanToMcpResponse({
        plan,
        primaryPrompt: null,
      })
    );

    if (adaptersEnabled) {
      const targets: PreferredAI[] = input.generateAllAdapters
        ? ALL_AI_ADAPTERS.map((a) => a.id)
        : [preferred];
      for (const id of targets) {
        const adapter = getAdapter(id);
        if (!adapter) continue;
        pushTimed(adapter.render(adapterContext));
        if (verificationEnabled) {
          const vContent = renderVerificationPrompt(adapterContext, id);
          pushTimed({
            adapterId: id,
            format: "prompt",
            content: vContent,
            tokenEstimate: Math.ceil(vContent.length / 4),
          });
        }
      }
    }

    const primaryAdapter = getAdapter(preferred);
    const primaryPrompt = adaptersEnabled && primaryAdapter ? primaryAdapter.render(adapterContext).content : null;
    const tokenCount = adapterOutputs.reduce((sum, o) => sum + o.tokenEstimate, 0);
    const engineeringPlanId = randomUUID();

    this.logger.log({
      event: "universal_engineering_completed",
      requestId: input.requestId,
      metadata: {
        engineeringPlanId,
        campaignId: campaign.campaignId,
        adapter: preferred,
        generationTimeMs: Date.now() - startedAt,
        tokenCount,
        estimatedComplexity: plan.estimatedComplexity,
        selectedStrategy: plan.selectedStrategy,
      },
    });

    const blResult = input.results.find((r) => r.agentId === "logic.business");
    const businessLogicRemediationInputs = blResult
      ? buildBusinessLogicUeeRemediationInputs(readBusinessLogicPlatformPayload(blResult))
      : undefined;

    const llmResult = input.results.find((r) => r.agentId === "ai.llm");
    const llmRemediationInputs = llmResult
      ? buildLlmUeeRemediationInputs(readLlmPlatformPayload(llmResult))
      : undefined;

    return {
      engineeringPlanId,
      plan,
      verificationPlan,
      adapterOutputs,
      primaryPrompt,
      primaryAdapterId: adaptersEnabled ? preferred : null,
      alternatePlanGenerated: shouldGenerateAlternateStrategy(replayStatus) && planVersion > 1,
      replayVerified: replayStatus === "passed",
      productionReadyViaReplayOnly: true,
      durationMs: Date.now() - startedAt,
      observability: {
        campaignId: campaign.campaignId,
        adapter: preferred,
        generationTimeMs: Date.now() - startedAt,
        tokenCount,
        estimatedComplexity: plan.estimatedComplexity,
        selectedStrategy: plan.selectedStrategy,
      },
      businessLogicRemediationInputs,
      llmRemediationInputs,
    };
  }
}

export function createUniversalEngineeringEngine(): UniversalEngineeringEngine {
  return new UniversalEngineeringEngine();
}
