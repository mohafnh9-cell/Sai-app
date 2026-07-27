import type { BusinessInvariant, BusinessInvariantConfidenceLevel, BusinessInvariantEvidence } from "./invariant.types";

export function classifyConfidence(input: {
  hasExplicitConstraint: boolean;
  hasGuardOnTransition: boolean;
  discoveryEvidenceMax: number;
  fromAssumptionOnly: boolean;
}): BusinessInvariantConfidenceLevel {
  if (input.fromAssumptionOnly) return "assumed";
  if (input.hasExplicitConstraint) return "explicit";
  if (input.hasGuardOnTransition && input.discoveryEvidenceMax >= 0.85) return "confirmed";
  if (input.hasGuardOnTransition || input.discoveryEvidenceMax >= 0.75) return "strongly_inferred";
  if (input.discoveryEvidenceMax >= 0.65) return "inferred";
  return "unsupported";
}

export function confidenceRank(level: BusinessInvariantConfidenceLevel): number {
  const order: BusinessInvariantConfidenceLevel[] = [
    "explicit",
    "confirmed",
    "strongly_inferred",
    "inferred",
    "assumed",
    "unsupported",
  ];
  return order.indexOf(level);
}

export function mergeInvariantEvidence(
  ...groups: BusinessInvariantEvidence[][]
): BusinessInvariantEvidence[] {
  const seen = new Set<string>();
  const out: BusinessInvariantEvidence[] = [];
  for (const group of groups) {
    for (const item of group) {
      const key = `${item.source}|${item.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function invariantPassesMinimumBar(invariant: BusinessInvariant): boolean {
  return invariant.confidence !== "unsupported" && invariant.evidence.length > 0;
}
