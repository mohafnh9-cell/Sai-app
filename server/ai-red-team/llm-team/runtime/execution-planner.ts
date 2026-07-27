import type { AIAttackCase } from "../attacks/attack.types";
import type { AIInvariant } from "../invariants/invariant.types";
import type { AIRuntimeContext, AIExecutionMode, AIExecutionPlan } from "./runtime.types";
import { ATTACK_SIMULATION_ENGINE } from "./runtime.types";
import {
  DEFAULT_AI_RUNTIME_LIMITS,
  DEFAULT_AI_RUNTIME_PROFILE,
} from "./runtime.config";
import { stableAiId } from "../model/stable-id";

function findInvariant(ctx: AIRuntimeContext, id: string): AIInvariant | null {
  return ctx.invariants.invariants.find((i) => i.id === id) ?? null;
}

function findAttack(ctx: AIRuntimeContext, id: string | null): AIAttackCase | null {
  if (!id) return null;
  return ctx.attacks.cases.find((c) => c.id === id) ?? null;
}

function resolveMode(input: {
  validationMode: string;
  attack: AIAttackCase | null;
  profile: typeof DEFAULT_AI_RUNTIME_PROFILE;
}): AIExecutionMode {
  if (input.validationMode === "static_plan_only") return "static_analysis";
  if (!input.profile.allowStagingCandidate && input.validationMode === "future_live_runtime") {
    return "blocked";
  }
  const category = input.attack?.category;
  if (!category) return "static_analysis";
  const engine = ATTACK_SIMULATION_ENGINE[category];
  if (engine?.includes("tool") || engine === "function_calling") return "synthetic_tool";
  if (engine?.includes("mcp")) return "synthetic_mcp";
  if (engine?.includes("agent") || engine === "multi_agent_communication") return "synthetic_agent";
  if (engine?.includes("rag") || engine?.includes("vector")) return "synthetic_rag";
  if (engine === "streaming_responses") return "mock_llm";
  if (engine === "conversation_leakage" || engine === "memory_poisoning") return "conversation_simulation";
  if (engine === "prompt_injection" || engine === "indirect_prompt_injection") return "mock_llm";
  return "mock_llm";
}

function simulationEngineForAttack(attack: AIAttackCase | null): string {
  if (!attack) return "static_analysis";
  return ATTACK_SIMULATION_ENGINE[attack.category] ?? "static_analysis";
}

export function planAiExecutions(context: AIRuntimeContext): AIExecutionPlan[] {
  const profile = context.profile ?? DEFAULT_AI_RUNTIME_PROFILE;
  const limits = context.limits ?? DEFAULT_AI_RUNTIME_LIMITS;
  const plans: AIExecutionPlan[] = [];

  for (const specialistResult of context.specialistSummary.results) {
    if (!specialistResult.plan) continue;
    if (specialistResult.status !== "completed" && specialistResult.status !== "partial") continue;

    for (const step of specialistResult.plan.validationSteps) {
      const invariant = findInvariant(context, step.targetInvariantId);
      if (!invariant) continue;

      const attack = findAttack(context, step.targetAttackCaseId);
      const mode = resolveMode({
        validationMode: step.validationMode,
        attack,
        profile,
      });

      const pathId =
        invariant.relationships.executionPathId ??
        context.graph.paths.find((p) => p.purpose === "canonical_happy_path")?.id ??
        null;

      plans.push({
        id: stableAiId(`ai-exec-plan:${step.id}`),
        specialistPlanId: specialistResult.plan.id,
        specialistId: specialistResult.specialistId,
        specialistStepId: step.id,
        targetAttackCaseId: step.targetAttackCaseId,
        targetInvariantId: step.targetInvariantId,
        targetTrustBoundaryId: step.targetTrustBoundaryId,
        targetComponentNodeIds: step.targetComponentNodeIds,
        executionPathId: pathId,
        attackSequenceStepIds: attack?.sequence.steps.map((s) => stableAiId(`atk-step:${s.order}`)) ?? [],
        expectedViolatedInvariantIds: [invariant.id],
        expectedEvidenceRefIds: step.expectedEvidenceRefIds,
        executionMode: mode === "blocked" ? "blocked" : mode,
        simulationEngine: simulationEngineForAttack(attack),
        maxRuntimeMs: Math.min(specialistResult.plan.maximumRuntimeBudgetMs, limits.perPlanTimeoutMs),
        maxPromptCount: limits.perPlanMaxPrompts,
        maxToolInvocations: limits.perPlanMaxToolInvocations,
        rollbackStrategy: "synthetic_reset",
        assumptions: specialistResult.plan.requiredAssumptions,
      });
    }
  }

  return plans.slice(0, context.budget.maxPlans);
}

export const AIExecutionPlanner = {
  plan: planAiExecutions,
};
