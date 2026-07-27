import type { BusinessDiscoveryEvidence } from "../discovery/discovery.types";
import type { BusinessEvidenceRef, BusinessMetadata } from "./domain.types";

export function toEvidenceRefs(evidence: BusinessDiscoveryEvidence[]): BusinessEvidenceRef[] {
  return evidence.map((e) => ({
    id: e.id,
    source: e.source,
    detail: e.detail,
    confidence: e.confidence,
  }));
}

export function buildMetadata(input: {
  evidence: BusinessDiscoveryEvidence[];
  discoveredEntityId?: string | null;
  discoveredWorkflowId?: string | null;
  discoveredWorkflowKind?: string | null;
  tags?: string[];
}): BusinessMetadata {
  return {
    discoveredEntityId: input.discoveredEntityId ?? null,
    discoveredWorkflowId: input.discoveredWorkflowId ?? null,
    discoveredWorkflowKind: input.discoveredWorkflowKind ?? null,
    tags: input.tags ?? [],
    evidence: toEvidenceRefs(input.evidence),
  };
}

export function mergeEvidence(
  ...groups: BusinessDiscoveryEvidence[][]
): BusinessDiscoveryEvidence[] {
  const seen = new Set<string>();
  const out: BusinessDiscoveryEvidence[] = [];
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
