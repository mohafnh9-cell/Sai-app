import type { ProductionVerdictV1, VerdictStatus } from "../schema";
import { VERDICT_STATUS_LABELS } from "../schema";
import { EVIDENCE_LIMITED_HEADLINE, verdictHeadline } from "../status-rules";
import { verdictAffirmsDeploy } from "../deployment-posture";

/** @deprecated Use ProductionVerdictV1 from schema.ts — legacy UI adapter */
export type LegacyProductionVerdictStatus =
  | "ready_for_production"
  | "almost_ready"
  | "needs_improvements"
  | "not_ready"
  | "not_scanned";

export type LegacyProductionVerdict = {
  status: LegacyProductionVerdictStatus;
  headline: string;
  score: number | null;
  blockersCount: number;
  improvementsCount: number;
  priorities: Array<{
    rank: number;
    title: string;
    estimatedMinutes: number;
    scoreDelta: number;
  }>;
  estimatedTotalMinutes: number;
  projectedScore: number | null;
  scoreDelta: number | null;
  recommendedAction: string;
  evaluatedAreas: Array<{
    key: string;
    label: string;
    status: string;
    score: number | null;
  }>;
  methodologyNote: string;
  /** Full v1 contract for consumers migrating off legacy shape */
  v1: ProductionVerdictV1;
};

const STATUS_TO_LEGACY: Record<VerdictStatus, LegacyProductionVerdictStatus> = {
  ready_to_ship: "ready_for_production",
  almost_ready: "almost_ready",
  needs_improvement: "needs_improvements",
  not_ready: "not_ready",
  insufficient_data: "not_scanned",
  analysis_failed: "not_scanned",
};

export const LEGACY_VERDICT_LABELS: Record<LegacyProductionVerdictStatus, string> = {
  ready_for_production: VERDICT_STATUS_LABELS.ready_to_ship,
  almost_ready: VERDICT_STATUS_LABELS.almost_ready,
  needs_improvements: VERDICT_STATUS_LABELS.needs_improvement,
  not_ready: VERDICT_STATUS_LABELS.not_ready,
  not_scanned: VERDICT_STATUS_LABELS.insufficient_data,
};

/**
 * The legacy human-readable headline. A raw `ready_to_ship` status never yields "READY TO SHIP" by itself: it needs
 * the canonical approval gate (`verdictAffirmsDeploy`: high confidence AND every area evaluated; missing or
 * unreadable evidence is not approval). The machine-readable `status` and `v1` fields are unchanged.
 */
export function legacyVerdictHeadline(
  verdict: Pick<ProductionVerdictV1, "status" | "confidence" | "unevaluatedAreas" | "partiallyEvaluatedAreas">
): string {
  if (verdict.status === "ready_to_ship" && !verdictAffirmsDeploy(verdict)) return EVIDENCE_LIMITED_HEADLINE;
  return verdictHeadline(verdict.status);
}

export function toLegacyVerdict(verdict: ProductionVerdictV1): LegacyProductionVerdict {
  const legacyStatus = STATUS_TO_LEGACY[verdict.status];
  const allAreas = [
    ...verdict.evaluatedAreas,
    ...verdict.partiallyEvaluatedAreas,
    ...verdict.unevaluatedAreas,
  ];

  return {
    status: legacyStatus,
    headline: legacyVerdictHeadline(verdict),
    score: verdict.score,
    blockersCount: verdict.blockersCount,
    improvementsCount: Math.max(0, verdict.findingsCount - verdict.blockersCount),
    priorities: verdict.topPriorities.map((p) => ({
      rank: p.rank,
      title: p.title,
      estimatedMinutes: p.estimatedMinutes,
      scoreDelta: p.projectedScoreImpact,
    })),
    estimatedTotalMinutes: verdict.estimatedFixMinutes,
    projectedScore: verdict.projectedScore,
    scoreDelta: verdict.scoreDelta,
    recommendedAction: verdict.recommendedAction,
    evaluatedAreas: allAreas.map((area) => ({
      key: area.key,
      label: area.label,
      status: area.status === "partial" ? "partially_evaluated" : area.status.replace("not_evaluated", "not_yet_evaluated"),
      score: area.score,
    })),
    methodologyNote: verdict.methodologyNote,
    v1: verdict,
  };
}

export function legacyStatusFromV1(status: VerdictStatus): LegacyProductionVerdictStatus {
  return STATUS_TO_LEGACY[status];
}
