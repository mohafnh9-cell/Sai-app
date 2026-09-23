import "server-only";

import { buildProductionJourney, type JourneyTrend } from "@/brain/production-journey";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { resolveCanonicalDecisionState } from "../canonical-decision-state";
import type { DeploymentDecision } from "../decision-mapping";
import type { FreshnessStatus } from "../staleness";
import { loadVerdictJourneyRecords } from "@/server/production-journey/load-verdicts";
import type { McpAuthContext } from "../auth";
import type { McpTranslator } from "../i18n";
import type { ProjectSelector } from "../project-resolution";
import { resolveMcpProject } from "../project-resolution";
import { buildProjectHistoryUrl } from "../report-url";
import { formatProductionHistoryEmpty, formatProductionHistoryResponse } from "../personality";

export type ProductionHistoryRange = "7d" | "30d" | "all";

export type ProductionHistoryInput = ProjectSelector & {
  range?: ProductionHistoryRange;
  limit?: number;
};

export type ProductionHistoryPoint = {
  score: number | null;
  status: VerdictStatus;
  generatedAt: string;
};

export type ProductionHistoryResult = {
  mode: "production_history";
  source: "github";
  project: { id: string; name: string; repositoryFullName: string | null };
  /**
   * AUTHORITATIVE: the persisted Production Verdict resolved through the
   * same canonical decision state can_i_deploy uses. Everything else in this
   * result (recentVerdicts, bestScore, trend, ...) is HISTORICAL.
   */
  currentVerdict: VerdictStatus | null;
  currentScore: number | null;
  currentVerdictScanId: string | null;
  currentVerdictCommitSha: string | null;
  currentDecision: DeploymentDecision | null;
  reviewInProgress: boolean;
  freshnessStatus: FreshnessStatus | null;
  /** "history_fallback" only when no authoritative verdict could be resolved. */
  currentVerdictSource: "authoritative" | "history_fallback" | "none";
  bestScore: number | null;
  trend: JourneyTrend;
  totalValidReviews: number;
  failedReviews: number;
  recentVerdicts: ProductionHistoryPoint[];
  blockersResolved: number;
  blockersDetected: number;
  firstReviewedAt: string | null;
  lastReviewedAt: string | null;
  historyUrl: string | null;
  summary: string;
};

const DEFAULT_RECENT_LIMIT = 7;
const MAX_RECENT_LIMIT = 20;
const RANGE_DAYS: Record<ProductionHistoryRange, number | null> = {
  "7d": 7,
  "30d": 30,
  all: null,
};

/**
 * "How has my project evolved?" — retrieves persisted verdict history and
 * aggregates it via the existing Production History (Journey) engine.
 * ADR-001: trend/maturity/milestones are aggregations over already-computed
 * per-verdict truth; no new score or status is calculated here.
 */
export async function productionHistory(
  ctx: McpAuthContext,
  input: ProductionHistoryInput,
  t: McpTranslator
): Promise<ProductionHistoryResult> {
  const project = await resolveMcpProject(ctx, input, t);
  const range = input.range ?? "all";
  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_RECENT_LIMIT), MAX_RECENT_LIMIT);

  const { records } = await loadVerdictJourneyRecords(ctx.admin, project.id, { limit: 200 });

  if (records.length === 0) {
    return {
      mode: "production_history",
      source: "github",
      project,
      currentVerdict: null,
      currentScore: null,
      currentVerdictScanId: null,
      currentVerdictCommitSha: null,
      currentDecision: null,
      reviewInProgress: false,
      freshnessStatus: null,
      currentVerdictSource: "none",
      bestScore: null,
      trend: "insufficient_data",
      totalValidReviews: 0,
      failedReviews: 0,
      recentVerdicts: [],
      blockersResolved: 0,
      blockersDetected: 0,
      firstReviewedAt: null,
      lastReviewedAt: null,
      historyUrl: buildProjectHistoryUrl(project.id),
      summary: formatProductionHistoryEmpty(t),
    };
  }

  const journey = buildProductionJourney(records, { limit: 200 });
  const state = await resolveCanonicalDecisionState(ctx, project.id);

  const rangeDays = RANGE_DAYS[range];
  const cutoff = rangeDays != null ? Date.now() - rangeDays * 24 * 60 * 60 * 1000 : null;

  const recentVerdicts: ProductionHistoryPoint[] = journey.timeline
    .filter((point) => !cutoff || new Date(point.generatedAt).getTime() >= cutoff)
    .slice(-limit)
    .map((point) => ({ score: point.score, status: point.status, generatedAt: point.generatedAt }));

  const recentSparkline = recentVerdicts
    .map((p) => (p.score != null ? String(p.score) : "—"))
    .join(" → ");

  const summary = formatProductionHistoryResponse(t, {
    trendKey: journey.trend,
    recentSparkline: recentSparkline || "—",
    validReviews: journey.validReviews,
  });

  return {
    mode: "production_history",
    source: "github",
    project,
    currentVerdict: state ? state.verdict.status : journey.currentStatus,
    currentScore: state ? state.verdict.score : journey.currentScore,
    currentVerdictScanId: state?.verdict.scanId ?? null,
    currentVerdictCommitSha: state?.verdict.commitSha ?? null,
    currentDecision: state?.decision ?? null,
    reviewInProgress: state?.reviewInProgress ?? false,
    freshnessStatus: state?.staleness.freshnessStatus ?? null,
    currentVerdictSource: state ? "authoritative" : "history_fallback",
    bestScore: journey.bestScore,
    trend: journey.trend,
    totalValidReviews: journey.validReviews,
    failedReviews: journey.failedReviews,
    recentVerdicts,
    blockersResolved: journey.blockersResolved,
    blockersDetected: journey.blockersIntroduced,
    firstReviewedAt: journey.firstReviewedAt,
    lastReviewedAt: journey.lastReviewedAt,
    historyUrl: buildProjectHistoryUrl(project.id),
    summary,
  };
}
