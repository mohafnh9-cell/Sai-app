import type { AIInvariant, AIInvariantConfidence, AIInvariantEvidence } from "./invariant.types";

export function classifyAiInvariantConfidence(input: {
  hasBoundary: boolean;
  hasExplicitEdge: boolean;
  evidenceMax: number;
  fromAssumptionOnly: boolean;
}): AIInvariantConfidence {
  if (input.fromAssumptionOnly) return "assumed";
  if (input.hasExplicitEdge && input.hasBoundary && input.evidenceMax >= 0.9) return "explicit";
  if (input.hasBoundary && input.evidenceMax >= 0.85) return "confirmed";
  if (input.hasBoundary || input.evidenceMax >= 0.75) return "strongly_inferred";
  if (input.evidenceMax >= 0.65) return "inferred";
  return "unsupported";
}

export function confidenceRank(level: AIInvariantConfidence): number {
  const order: AIInvariantConfidence[] = [
    "explicit",
    "confirmed",
    "strongly_inferred",
    "inferred",
    "assumed",
    "unsupported",
  ];
  return order.indexOf(level);
}

export function mergeAiInvariantEvidence(...groups: AIInvariantEvidence[][]): AIInvariantEvidence[] {
  const seen = new Set<string>();
  const out: AIInvariantEvidence[] = [];
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

export function invariantPassesMinimumBar(invariant: AIInvariant): boolean {
  return (
    invariant.confidence !== "unsupported" &&
    invariant.evidence.length > 0 &&
    invariant.relationships.graphNodeIds.length > 0 &&
    Boolean(invariant.protectedTrustBoundaryId)
  );
}

export function maxEvidenceConfidence(evidence: AIInvariantEvidence[]): number {
  if (evidence.length === 0) return 0;
  return Math.max(...evidence.map((e) => e.confidence));
}
