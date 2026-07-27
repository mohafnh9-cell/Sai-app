import type { AcceptedRiskRecord } from "./decision-model";
import type { SecurityIntelligenceReport } from "../intelligence/models";

export type RiskAcceptanceInfluence = {
  suppressedBlockerFindingIds: string[];
  activeAcceptedRisks: AcceptedRiskRecord[];
  note: string | null;
};

export function applyAcceptedRisks(input: {
  intelligence: SecurityIntelligenceReport;
  acceptedRisks?: AcceptedRiskRecord[];
  nowMs?: number;
}): RiskAcceptanceInfluence {
  const now = input.nowMs ?? Date.now();
  const active =
    input.acceptedRisks?.filter((r) => Date.parse(r.expiration) > now) ?? [];

  const suppressedBlockerFindingIds = active
    .map((r) => r.findingId)
    .filter((id) => input.intelligence.priorities.some((p) => p.findingId === id));

  return {
    suppressedBlockerFindingIds,
    activeAcceptedRisks: active,
    note:
      active.length > 0
        ? `${active.length} accepted risk(s) recorded — findings remain visible but may reduce deploy block.`
        : null,
  };
}
