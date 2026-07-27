import type { OrchestratorBudgetMode, ReplayStrategyMode } from "../aso.types";
import type { EngineeringStrategyVariant } from "../../engineering/uee.types";
import type { PreferredAI } from "../../engineering/uee.types";
import type { ProductionMemorySnapshot } from "../../intelligence/models";

export function resolveReplayStrategy(input: {
  budgetMode: OrchestratorBudgetMode;
  previousReplayFailed?: boolean;
  criticalFindingCount?: number;
}): ReplayStrategyMode {
  if (input.previousReplayFailed) return "full";
  if (input.budgetMode === "fast") return "critical_only";
  if (input.budgetMode === "maximum") return "full";
  if (input.budgetMode === "deep") return "regression";
  return "partial";
}

export function resolveEngineeringStrategy(input: {
  budgetMode: OrchestratorBudgetMode;
  previousReplayFailed?: boolean;
  riskLevel?: "low" | "medium" | "high";
}): EngineeringStrategyVariant {
  if (input.previousReplayFailed) return "best_practice";
  if (input.budgetMode === "fast") return "quick_fix";
  if (input.budgetMode === "maximum" || input.riskLevel === "high") return "best_practice";
  if (input.budgetMode === "deep") return "architecture_refactor";
  return "production_fix";
}

export function resolveAiStrategy(input: {
  userPreferred?: PreferredAI | null;
  hasLlm: boolean;
  generateAllAdapters?: boolean;
}): { preferredAI: PreferredAI | null; generateAllAdapters: boolean } {
  if (input.generateAllAdapters) {
    return { preferredAI: input.userPreferred ?? "cursor", generateAllAdapters: true };
  }
  if (input.userPreferred) {
    return { preferredAI: input.userPreferred, generateAllAdapters: false };
  }
  return { preferredAI: input.hasLlm ? "claude_code" : "cursor", generateAllAdapters: false };
}

export function budgetParallelLimit(mode: OrchestratorBudgetMode): number {
  switch (mode) {
    case "fast":
      return 2;
    case "balanced":
      return 4;
    case "deep":
      return 4;
    case "maximum":
      return 6;
  }
}

export function memoryHints(memory?: ProductionMemorySnapshot | null): string[] {
  if (!memory?.events?.length) return [];
  const hints: string[] = [];
  const types = new Set(memory.events.map((e) => e.type));
  if (types.has("fix_strategy_replay_failed") || types.has("fix_strategy_replay_verified")) {
    hints.push("Prior replay outcomes available — adjust strategy accordingly.");
  }
  if (types.has("security_deployment_blocked")) {
    hints.push("Previous deployment was blocked; prioritize regression replay.");
  }
  return hints;
}
