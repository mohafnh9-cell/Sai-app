import type {
  AIAttackCase,
  AIAttackCollection,
  AIAttackGenerationInput,
  AIAttackGenerationResult,
  AIAttackStrategy,
} from "./attack.types";
import { AIAttackPlanner } from "./attack-planner";
import { defaultAiAttackStrategies } from "./attack-strategies";
import { validateAttackCollection } from "./attack-validator";
import { stableAiId } from "../model/stable-id";

function dedupeAttacks(cases: AIAttackCase[]): AIAttackCase[] {
  const byKey = new Map<string, AIAttackCase>();
  for (const c of cases) {
    if (!byKey.has(c.attackKey)) byKey.set(c.attackKey, c);
  }
  return [...byKey.values()].sort((a, b) => a.attackKey.localeCompare(b.attackKey));
}

export function generateAiAttackCases(
  input: AIAttackGenerationInput,
  extensionStrategies: AIAttackStrategy[] = []
): AIAttackGenerationResult {
  const planned = AIAttackPlanner.plan(input.invariants.invariants);
  const strategies = AIAttackPlanner.mergeStrategies(defaultAiAttackStrategies, extensionStrategies);

  const raw: AIAttackCase[] = [];

  for (const invariant of planned) {
    const ctx = { graph: input.graph, invariant };
    for (const strategy of strategies) {
      if (!strategy.invariantCategories.includes(invariant.category)) continue;
      raw.push(...strategy.generate(ctx));
    }
  }

  const deduped = dedupeAttacks(raw.filter((c) => c.confidence !== "unsupported"));

  const collection: AIAttackCollection = {
    id: stableAiId(`attack-collection:${input.graph.id}:${input.invariants.id}`),
    executionGraphId: input.graph.id,
    invariantCollectionId: input.invariants.id,
    cases: deduped,
    validationIssues: [],
    generatedAt: new Date().toISOString(),
  };

  const validated = validateAttackCollection(collection, input.graph, input.invariants);
  const rejected = validated.validationIssues.filter((i) =>
    ["missing_invariant", "impossible_topology", "missing_component", "speculative"].includes(i.code)
  ).length;

  return {
    collection: validated,
    plannedInvariantCount: planned.length,
    generatedCount: deduped.length,
    acceptedCount: validated.cases.length,
    rejectedCount: rejected,
  };
}

export const AIAttackGenerator = {
  generate: generateAiAttackCases,
};
