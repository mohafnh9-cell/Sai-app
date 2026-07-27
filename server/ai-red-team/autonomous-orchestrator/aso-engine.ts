import { randomUUID } from "node:crypto";
import { createRedTeamLogger } from "../logging/red-team-logger";
import type { AutonomousOrchestratorInput, OrchestratorDecision, OrchestratorExecutionPlan } from "./aso.types";
import { analyzeDiscoverySignals } from "./discovery/discovery-analysis";
import { selectTeams, selectedAttackDomains, staticSiteBrowserOnly } from "./planning/team-selector";
import {
  buildExecutionGraph,
  buildParallelWaves,
  domainOrderFromGraph,
} from "./planning/execution-graph";
import {
  budgetParallelLimit,
  memoryHints,
  resolveAiStrategy,
  resolveEngineeringStrategy,
  resolveReplayStrategy,
} from "./strategy/strategy-resolvers";
import { isFeatureEnabled } from "@/server/feature-flags";
import { planBusinessLogicOrchestrationMetadata } from "./business-logic-orchestration";
import { planLlmOrchestrationMetadata } from "./llm-orchestration";

export class AutonomousSecurityOrchestrator {
  constructor(private readonly logger = createRedTeamLogger()) {}

  plan(input: AutonomousOrchestratorInput): OrchestratorDecision {
    const scheduleStart = Date.now();
    const budgetMode = input.budgetMode ?? "balanced";
    const signals = analyzeDiscoverySignals(input.discovery);
    const adaptive = input.adaptiveTeamSelection !== false;

    const teamSelections = selectTeams({ signals, adaptive });
    const selectedTeams = teamSelections.filter((s) => s.selected).map((s) => s.teamId);
    const skippedTeams = teamSelections
      .filter((s) => !s.selected)
      .map((s) => ({ teamId: s.teamId, reason: s.skipReason ?? "skipped" }));

    const executionGraph = buildExecutionGraph(teamSelections);
    const parallelEnabled = input.parallelExecutionEnabled !== false;
    const waves = buildParallelWaves({ selections: teamSelections, parallelEnabled });
    const attackDomains = selectedAttackDomains(teamSelections);
    const domainOrder = domainOrderFromGraph(teamSelections);

    const replayStrategy = resolveReplayStrategy({
      budgetMode,
      previousReplayFailed: input.previousReplayFailed,
    });
    const engineeringStrategy = resolveEngineeringStrategy({
      budgetMode,
      previousReplayFailed: input.previousReplayFailed,
      riskLevel: signals.hasLlm ? "high" : "medium",
    });
    const ai = resolveAiStrategy({
      userPreferred: input.userPreferences?.preferredAI ?? null,
      hasLlm: signals.hasLlm,
      generateAllAdapters: input.userPreferences?.generateAllAdapters,
    });

    const hints = memoryHints(input.memory);
    const estimatedDurationMs = teamSelections
      .filter((s) => s.selected)
      .reduce((sum, s) => sum + s.estimatedRuntimeMs, 0);

    const schedulingMs = Date.now() - scheduleStart;

    const executionPlan: OrchestratorExecutionPlan = {
      planId: randomUUID(),
      createdAt: new Date().toISOString(),
      budgetMode,
      discoverySignals: signals,
      teamSelections,
      selectedTeams,
      skippedTeams,
      executionGraph,
      waves,
      attackDomains,
      domainOrder,
      maxParallel: parallelEnabled ? budgetParallelLimit(budgetMode) : 1,
      replayStrategy,
      engineeringStrategy,
      preferredAI: ai.preferredAI,
      generateAllAdapters: ai.generateAllAdapters,
      confidence: staticSiteBrowserOnly(teamSelections) ? 0.92 : signals.hasLlm ? 0.78 : 0.85,
      estimatedDurationMs,
      estimatedTokenUsage: Math.round(estimatedDurationMs / 20),
      schedulingMs,
      memoryHints: hints,
      businessLogicScheduling: planBusinessLogicOrchestrationMetadata({
        discovery: input.discovery,
        businessLogicEnabled: isFeatureEnabled("business_logic_team", {
          organizationId: input.organizationId,
        }),
      }),
      llmScheduling: planLlmOrchestrationMetadata({
        discovery: input.discovery,
        llmEnabled: isFeatureEnabled("llm_team", {
          organizationId: input.organizationId,
        }),
      }),
    };

    const rationale = [
      `Budget mode: ${budgetMode}`,
      `Selected ${selectedTeams.length} teams, skipped ${skippedTeams.length}`,
      parallelEnabled ? "Parallel execution enabled for independent teams" : "Sequential execution",
      `Replay strategy: ${replayStrategy}`,
      `Engineering strategy: ${engineeringStrategy}`,
    ];

    this.logger.log({
      event: "autonomous_orchestrator_planned",
      requestId: input.requestId,
      metadata: {
        engineeringPlanId: executionPlan.planId,
        campaignId: input.projectId,
        selectedTeams: selectedTeams.length,
        skippedTeams: skippedTeams.length,
        parallelism: executionPlan.maxParallel,
        schedulingMs,
        confidence: executionPlan.confidence,
      },
    });

    return {
      decisionId: randomUUID(),
      executionPlan,
      rationale,
    };
  }
}

export function createAutonomousSecurityOrchestrator(): AutonomousSecurityOrchestrator {
  return new AutonomousSecurityOrchestrator();
}

/** Planning must complete under 1s — used in tests. */
export function scheduleOrchestrator(input: AutonomousOrchestratorInput): OrchestratorExecutionPlan {
  return createAutonomousSecurityOrchestrator().plan(input).executionPlan;
}
