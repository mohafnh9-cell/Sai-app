import type { AIInvariant } from "../invariants/invariant.types";
import { invariantPassesMinimumBar } from "../invariants/invariant-confidence";
import type { AIAttackStrategy } from "./attack.types";

export function planAttacksForInvariants(invariants: AIInvariant[]): AIInvariant[] {
  return invariants.filter(invariantPassesMinimumBar);
}

export function mergeAttackStrategies(
  core: AIAttackStrategy[],
  extensions: AIAttackStrategy[] = []
): AIAttackStrategy[] {
  const byId = new Map<string, AIAttackStrategy>();
  for (const strategy of [...core, ...extensions]) {
    if (!byId.has(strategy.id)) byId.set(strategy.id, strategy);
  }
  return [...byId.values()];
}

export const AIAttackPlanner = {
  plan: planAttacksForInvariants,
  mergeStrategies: mergeAttackStrategies,
};
