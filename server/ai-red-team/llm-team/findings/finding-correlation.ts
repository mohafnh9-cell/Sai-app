import type { AIExecutionEvidence } from "../runtime/runtime.types";
import type { AIFinding, AIFindingEvidence } from "./finding.types";

export function mapRuntimeToFindingEvidence(
  executionId: string,
  evidence: AIExecutionEvidence[]
): AIFindingEvidence[] {
  return evidence.map((item) => ({
    id: item.id,
    source:
      item.source === "runtime_simulation" || item.source === "synthetic_llm"
        ? "runtime"
        : item.source === "invariant"
          ? "invariant"
          : item.source === "attack_hypothesis"
            ? "attack"
            : "runtime",
    detail: item.detail,
    confidence: item.confidence,
    refId: item.refId ?? null,
    executionId,
  }));
}

export function hasValidatedRuntimeEvidence(evidence: AIFindingEvidence[]): boolean {
  return evidence.some((e) => e.source === "runtime" && e.executionId !== null);
}

export function correlateFindings(findings: AIFinding[]): AIFinding[] {
  const groups = new Map<string, AIFinding[]>();

  for (const finding of findings) {
    const key = [
      finding.correlation.trustBoundaryId,
      finding.correlation.invariantKey,
      finding.category,
      finding.correlation.rootCause,
    ].join("|");
    const list = groups.get(key) ?? [];
    list.push(finding);
    groups.set(key, list);
  }

  const merged: AIFinding[] = [];

  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) => rankConfidence(b.confidence) - rankConfidence(a.confidence)
    );
    const primary = sorted[0]!;
    const duplicates = sorted.slice(1);

    const combinedEvidence = dedupeEvidence([
      ...primary.evidence,
      ...duplicates.flatMap((d) => d.evidence),
    ]);

    merged.push({
      ...primary,
      status: duplicates.length > 0 ? "confirmed" : primary.status,
      evidence: combinedEvidence,
      specialistIds: [...new Set([...primary.specialistIds, ...duplicates.flatMap((d) => d.specialistIds)])],
      executionSummary:
        duplicates.length > 0
          ? `${primary.executionSummary} (${duplicates.length} correlated finding(s) merged).`
          : primary.executionSummary,
      correlation: {
        ...primary.correlation,
        keys: [...new Set([primary.findingKey, ...duplicates.map((d) => d.findingKey)])],
      },
      traceability: {
        ...primary.traceability,
        graphNodeIds: [
          ...new Set([
            ...primary.traceability.graphNodeIds,
            ...duplicates.flatMap((d) => d.traceability.graphNodeIds),
          ]),
        ],
      },
    });
  }

  return merged;
}

function dedupeEvidence(items: AIFindingEvidence[]): AIFindingEvidence[] {
  const map = new Map<string, AIFindingEvidence>();
  for (const item of items) map.set(item.id, item);
  return [...map.values()];
}

function rankConfidence(confidence: AIFinding["confidence"]): number {
  const order = ["confirmed", "highly_likely", "likely", "possible", "unsupported"];
  return order.indexOf(confidence);
}

export const aiFindingCorrelation = {
  merge: correlateFindings,
  mapEvidence: mapRuntimeToFindingEvidence,
};
