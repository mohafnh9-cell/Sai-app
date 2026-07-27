import type { BusinessLogicExecutionEvidence } from "../runtime/runtime.types";
import type { BusinessLogicFinding, BusinessLogicFindingEvidence } from "./finding.types";

export function mapRuntimeEvidence(
  executionId: string,
  evidence: BusinessLogicExecutionEvidence[]
): BusinessLogicFindingEvidence[] {
  return evidence.map((item) => ({
    id: item.id,
    source:
      item.source === "runtime_mock"
        ? "runtime"
        : item.source === "fsm"
          ? "fsm"
          : item.source === "invariant"
            ? "invariant"
            : "runtime",
    detail: item.detail,
    confidence: item.confidence,
    refId: item.refId ?? null,
    executionId,
  }));
}

export function hasRuntimeBackedEvidence(evidence: BusinessLogicFindingEvidence[]): boolean {
  return evidence.some((e) => e.source === "runtime" || e.source === "fsm");
}

export function correlateFindings(findings: BusinessLogicFinding[]): BusinessLogicFinding[] {
  const groups = new Map<string, BusinessLogicFinding[]>();

  for (const finding of findings) {
    const key = [
      finding.correlation.workflowId,
      finding.correlation.invariantKey,
      finding.correlation.abuseKey ?? "none",
    ].join("|");
    const list = groups.get(key) ?? [];
    list.push(finding);
    groups.set(key, list);
  }

  const merged: BusinessLogicFinding[] = [];

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
      evidence: combinedEvidence,
      specialistIds: [
        ...new Set([...primary.specialistIds, ...duplicates.flatMap((d) => d.specialistIds)]),
      ],
      transitionIds: [
        ...new Set([...primary.transitionIds, ...duplicates.flatMap((d) => d.transitionIds)]),
      ],
      executionSummary:
        duplicates.length > 0
          ? `${primary.executionSummary} (${duplicates.length} duplicate hypothesis(es) merged).`
          : primary.executionSummary,
      correlation: {
        ...primary.correlation,
        keys: [...new Set([primary.findingKey, ...duplicates.map((d) => d.findingKey)])],
      },
    });
  }

  return merged;
}

function dedupeEvidence(items: BusinessLogicFindingEvidence[]): BusinessLogicFindingEvidence[] {
  const map = new Map<string, BusinessLogicFindingEvidence>();
  for (const item of items) map.set(item.id, item);
  return [...map.values()];
}

function rankConfidence(confidence: BusinessLogicFinding["confidence"]): number {
  const order = ["confirmed", "highly_likely", "likely", "possible", "unsupported"];
  return order.indexOf(confidence);
}

export const BusinessLogicFindingCorrelationEngine = {
  merge: correlateFindings,
};
