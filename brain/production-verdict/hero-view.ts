import type { OrgBrainSnapshot } from "../types";
import type { ProductionVerdictV1, VerdictStatus } from "./schema";
import { narrativeMayApprove } from "./narrative-guard";
import { EVIDENCE_LIMITED_RECOMMENDED_ACTION } from "./status-rules";
import { verdictHeadlineDisplay, verdictRecommendedAction, shouldShowScore } from "./status-ui";

export type ProductionHeroViewModel = {
  status: VerdictStatus;
  score: number | null;
  scoreDelta: number | null;
  blockersCount: number;
  estimatedFixMinutes: number;
  projectedScore: number | null;
  topPriorityTitle: string | null;
  evaluatedCoverage: number;
  headline: string;
  subheadline: string;
  analysisError: string | null;
};

export function heroViewFromVerdict(verdict: ProductionVerdictV1): ProductionHeroViewModel {
  const top = verdict.topPriorities[0];
  const evaluatedCoverage =
    verdict.evaluatedAreas.length + verdict.partiallyEvaluatedAreas.length;

  let subheadline = verdict.recommendedAction;
  if (verdict.status === "analysis_failed") {
    subheadline = "The latest analysis did not complete. Re-run the production check to retry.";
  } else if (verdict.status === "insufficient_data") {
    subheadline = "Connect a repository and run a full production analysis before shipping.";
  } else if (top) {
    subheadline = `${verdictRecommendedAction(verdict.status, verdict.blockersCount)} Top priority: ${top.title}.`;
  }

  // A ready_to_ship status is only headlined as ready when the evidence
  // supports approval (high confidence, every area evaluated).
  const evidenceLimited = verdict.status === "ready_to_ship" && !narrativeMayApprove(verdict);
  if (evidenceLimited && !top) subheadline = EVIDENCE_LIMITED_RECOMMENDED_ACTION;

  return {
    status: verdict.status,
    score: verdict.score,
    scoreDelta: verdict.scoreDelta,
    blockersCount: verdict.blockersCount,
    estimatedFixMinutes: verdict.estimatedFixMinutes,
    projectedScore: verdict.projectedScore,
    topPriorityTitle: top?.title ?? null,
    evaluatedCoverage,
    headline: evidenceLimited ? "NO BLOCKERS FOUND — EVIDENCE LIMITED" : verdictHeadlineDisplay(verdict.status),
    subheadline,
    analysisError: verdict.status === "analysis_failed" ? verdict.executiveSummary : null,
  };
}

export function heroViewFromOrgBrain(brain: OrgBrainSnapshot): ProductionHeroViewModel {
  const scored = brain.projects.filter((p) => p.productionReady !== null);
  const ready = brain.projects.filter((p) => p.status === "ready_to_ship").length;

  if (scored.length === 0) {
    return {
      status: "insufficient_data",
      score: null,
      scoreDelta: null,
      blockersCount: brain.totalBlockers,
      estimatedFixMinutes: brain.totalEstimatedMinutes,
      projectedScore: brain.productionRoadmap.projectedScore,
      topPriorityTitle: brain.todayPriorities[0]?.title ?? null,
      evaluatedCoverage: 0,
      headline: verdictHeadlineDisplay("insufficient_data"),
      subheadline:
        "Connect a project and run your first production readiness check to get started.",
      analysisError: null,
    };
  }

  const status: VerdictStatus =
    ready === brain.projects.length && brain.totalBlockers === 0
      ? "ready_to_ship"
      : brain.totalBlockers > 0
        ? "not_ready"
        : brain.averageProductionReady != null && brain.averageProductionReady >= 85
          ? "almost_ready"
          : "needs_improvement";

  return {
    status,
    score: brain.averageProductionReady,
    scoreDelta: null,
    blockersCount: brain.totalBlockers,
    estimatedFixMinutes: brain.totalEstimatedMinutes,
    projectedScore: brain.productionRoadmap.projectedScore,
    topPriorityTitle: brain.todayPriorities[0]?.title ?? null,
    evaluatedCoverage: scored.length,
    headline:
      ready > 0
        ? `${ready} PROJECT${ready === 1 ? "" : "S"} READY TO SHIP`
        : verdictHeadlineDisplay(status),
    subheadline: `${scored.length} project${scored.length === 1 ? "" : "s"} analyzed across your portfolio.`,
    analysisError: null,
  };
}

export function heroScoreDisplay(view: ProductionHeroViewModel): string {
  if (!shouldShowScore(view.score, view.status)) return "—";
  return String(view.score);
}
