import { createHash } from "node:crypto";
import { createRedTeamLogger } from "../logging/red-team-logger";
import type { FixStrategyEngineInput, FixStrategyReport } from "./fix-strategy.types";
import { buildReplayFixLinks, collectReplayPlansFromResults } from "./replay/replay-fix-bridge";
import { scoreFixStrategy } from "./scoring/safe-fix-score";
import { buildEngineeringReport } from "./report/engineering-report-builder";
import { buildAttackCampaignFromIntelligence } from "./campaign/attack-campaign";
import {
  createUniversalEngineeringEngine,
  type UniversalEngineeringEngine,
} from "../engineering/uee-engine";
import { getAdapter, renderVerificationPrompt } from "../engineering/adapters/ai-adapters";
import { resolvePreferredAI } from "../engineering/detection/preferred-ai";
import type { GroupedFix, RootCause } from "./fix-strategy.types";
import { analyzeRootCauses, assignUnmappedFindings, dedupeRootCauses } from "./root-cause/root-cause-engine";
import { buildGroupedFixes, mergeFixesWithSharedSolution } from "./strategy/grouped-fix-builder";
import { mapFindingToReplayIds } from "./replay/replay-fix-bridge";

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

/** Legacy facade — engineering logic lives in Universal Engineering Engine. */
export class FixStrategyEngine {
  constructor(
    private readonly uee: UniversalEngineeringEngine = createUniversalEngineeringEngine(),
    private readonly logger = createRedTeamLogger()
  ) {}

  plan(input: FixStrategyEngineInput): FixStrategyReport {
    const ueeResult = this.uee.run({
      ...input,
      previousPlanVersion: input.previousStrategyRevision,
      preferredAI: input.preferredAI ?? null,
      generateAllAdapters: input.generateAllAdapters,
    });

    const plan = ueeResult.plan;
    const preferred = resolvePreferredAI({ preferredAI: input.preferredAI });
    const implementationPrompt =
      ueeResult.primaryPrompt ??
      getAdapter(preferred)?.render({
        projectSummary: input.discovery.projectSummary,
        plan: ueeResult.plan,
        verificationPlan: ueeResult.verificationPlan,
      }).content ??
      "";

    const verificationOutput = ueeResult.adapterOutputs.find(
      (o) => o.adapterId === preferred && o.content.includes("Verification")
    );
    const verificationPrompt =
      verificationOutput?.content ??
      ueeResult.adapterOutputs
        .filter((o) => o.format === "prompt")
        .find((o) => o.content.startsWith("# Verification"))?.content ??
      renderVerificationPrompt(
        {
          projectSummary: input.discovery.projectSummary,
          plan: ueeResult.plan,
          verificationPlan: ueeResult.verificationPlan,
        },
        preferred
      );

    const campaign = buildAttackCampaignFromIntelligence(input.intelligence);
    const findings = input.intelligence.deduplicatedFindings;
    let rootCauses: RootCause[] = dedupeRootCauses(analyzeRootCauses(findings));
    rootCauses = assignUnmappedFindings(rootCauses, campaign.findingIds);
    const replayPlans = collectReplayPlansFromResults(input.results);
    let groupedFixes: GroupedFix[] = mergeFixesWithSharedSolution(
      buildGroupedFixes({
        rootCauses,
        findings,
        priorities: input.intelligence.priorities,
        discoverySummary: input.discovery.projectSummary,
        replayPlanIdsByFinding: mapFindingToReplayIds(replayPlans),
      })
    );

    const replayLinks = buildReplayFixLinks({
      groupedFixes,
      replayPlans,
      replayStatus: input.replayStatus ?? "not_run",
    });

    const filesAffected = plan.affectedFiles;
    const engineeringReport = buildEngineeringReport({
      campaign,
      rootCauses,
      groupedFixes,
      filesAffected,
      remainingRisks: plan.remainingRisks,
    });

    const safeFixScore = scoreFixStrategy({
      groupedFixes,
      findingCount: findings.length,
      backwardCompatible: true,
    });

    this.logger.log({
      event: "fix_strategy_completed",
      requestId: input.requestId,
      metadata: {
        strategyId: ueeResult.engineeringPlanId,
        engineeringPlanId: ueeResult.engineeringPlanId,
        campaignId: campaign.campaignId,
        rootCauses: plan.rootCauses.length,
        groupedFixes: plan.implementationOrder.length,
        generatedPrompts: ueeResult.adapterOutputs.length,
        estimatedEffort: plan.estimatedComplexity,
        durationMs: ueeResult.durationMs,
      },
    });

    return {
      strategyId: ueeResult.engineeringPlanId,
      campaignId: campaign.campaignId,
      strategyRevision: plan.version,
      campaign,
      rootCauses,
      groupedFixes,
      engineeringPlan: {
        implementationOrder: plan.implementationOrder.map((s) => s.stepId),
        constraints: plan.constraints,
        architectureNotes: plan.architectureChanges.map((a) => a.rationale),
        migrationRequired: plan.affectedFiles.some((f) => f.includes("migration")),
        backwardCompatible: true,
      },
      implementationPrompt,
      verificationPrompt,
      regressionTests: plan.regressionTests.map((t) => ({
        id: t.id,
        domain: t.domain,
        level: t.level,
        title: t.title,
        description: t.description,
      })),
      engineeringReport,
      replayLinks,
      safeFixScore,
      replayVerified: ueeResult.replayVerified,
      alternateStrategyGenerated: ueeResult.alternatePlanGenerated,
      productionReadyViaReplayOnly: true,
      durationMs: ueeResult.durationMs,
      universalEngineering: ueeResult,
    };
  }
}

export function createFixStrategyEngine(): FixStrategyEngine {
  return new FixStrategyEngine();
}

export function planFixStrategyBatch(
  engine: FixStrategyEngine,
  inputs: FixStrategyEngineInput[]
): FixStrategyReport[] {
  return inputs.map((input) => engine.plan(input));
}

export { hashPrompt };
