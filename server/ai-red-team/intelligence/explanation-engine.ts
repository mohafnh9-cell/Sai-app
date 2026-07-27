import type { AttackChain, FounderExplanation, NormalizedObservation, PrioritizedRemediation } from "./models";
import type { FindingCorrelationGroup } from "./models";

export function buildFounderExplanation(input: {
  observations: NormalizedObservation[];
  deduplicated: NormalizedObservation[];
  correlations: FindingCorrelationGroup[];
  chains: AttackChain[];
  priorities: PrioritizedRemediation[];
  topBlockerTitle: string | null;
}): FounderExplanation {
  const rawFindingCount = input.observations.length;
  const groupedFindingCount = input.deduplicated.length;
  const chain = input.chains[0];
  const chainGroups = input.correlations.filter((c) => c.kind === "attack_chain" || c.kind === "same_issue");

  const paragraphs: string[] = [];

  if (input.topBlockerTitle) {
    paragraphs.push(`The biggest deployment blocker is ${input.topBlockerTitle.toLowerCase()}.`);
  } else if (rawFindingCount === 0) {
    paragraphs.push("This red-team run did not produce correlated browser findings to rank.");
  } else {
    paragraphs.push("No single critical blocker dominated, but ranked improvements remain.");
  }

  if (chainGroups.length > 0) {
    const count = chainGroups[0]?.findingIds.length ?? 0;
    if (count >= 2) {
      paragraphs.push(`${count} findings contribute to the same attack path.`);
    }
  }

  if (chain && input.priorities.length > 0) {
    const top = input.priorities[0];
    const resolvedEstimate = Math.min(
      90,
      Math.round((chain.findingIds.length / Math.max(1, groupedFindingCount)) * 100)
    );
    paragraphs.push(
      `Fixing the top-ranked issue may remove approximately ${resolvedEstimate}% of the correlated deployment risk from this chain.`
    );
    if (top) {
      paragraphs.push(`Start with: ${input.observations.find((o) => o.id === top.findingId)?.title ?? "top priority item"}.`);
    }
    return {
      headline: paragraphs[0] ?? "Red-team intelligence summary",
      paragraphs: paragraphs.slice(1),
      groupedFindingCount,
      rawFindingCount,
      estimatedRiskReductionPercent: resolvedEstimate,
    };
  }

  return {
    headline: paragraphs[0] ?? "Red-team intelligence summary",
    paragraphs: paragraphs.slice(1),
    groupedFindingCount,
    rawFindingCount,
    estimatedRiskReductionPercent: null,
  };
}
