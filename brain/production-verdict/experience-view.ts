import type { ProductionVerdictV1, VerdictStatus } from "./schema";
import { verdictHeadlineDisplay, shouldShowScore } from "./status-ui";

export type VerdictExperienceView = {
  status: VerdictStatus;
  headline: string;
  statusMessage: string;
  score: number | null;
  scoreDelta: number | null;
  blockersCount: number;
  estimatedFixMinutes: number;
  projectedScore: number | null;
  projectedScoreIsEstimate: boolean;
  scoreImprovement: number | null;
  introducedBlockers: number;
  resolvedBlockers: number;
  deltaNarrative: string | null;
  deltaDirection: "up" | "down" | "flat" | null;
  executiveSummary: string;
  recommendedAction: string;
  commitSha: string | null;
  generatedAt: string;
  evaluatedAreaCount: number;
  coverageRatio: number | null;
  filesAnalyzed: number;
  showReadyMoment: boolean;
  showScore: boolean;
};

const STATUS_MESSAGES: Record<VerdictStatus, string> = {
  ready_to_ship: "Your application is ready to ship.",
  almost_ready: "You are close to production.",
  needs_improvement: "Your application needs a focused production pass.",
  not_ready: "Do not ship this version yet.",
  insufficient_data:
    "SequrAI needs more information before issuing a responsible verdict.",
  analysis_failed: "We could not complete this production review.",
};

export function buildDeltaNarrative(verdict: ProductionVerdictV1): {
  narrative: string | null;
  direction: "up" | "down" | "flat" | null;
} {
  const delta = verdict.scoreDelta;
  if (delta == null) return { narrative: null, direction: null };

  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const absDelta = Math.abs(delta);

  if (direction === "flat") {
    return {
      direction,
      narrative: "Your latest changes did not materially change production readiness.",
    };
  }

  const verb = direction === "up" ? "improved" : "reduced";
  const parts = [`Your latest push ${verb} readiness by ${absDelta} point${absDelta === 1 ? "" : "s"}.`];

  if (verdict.introducedBlockers > 0) {
    parts.push(
      `Introduced: ${verdict.introducedBlockers} production blocker${verdict.introducedBlockers === 1 ? "" : "s"}.`
    );
  }
  if (verdict.resolvedBlockers > 0) {
    parts.push(
      `Resolved: ${verdict.resolvedBlockers} production blocker${verdict.resolvedBlockers === 1 ? "" : "s"}.`
    );
  }

  return { narrative: parts.join(" "), direction };
}

export function verdictExperienceFromVerdict(
  verdict: ProductionVerdictV1,
  options?: { statusMessage?: string }
): VerdictExperienceView {
  const { narrative, direction } = buildDeltaNarrative(verdict);
  const showScore = shouldShowScore(verdict.score, verdict.status);
  const scoreImprovement =
    showScore && verdict.score != null && verdict.projectedScore != null
      ? verdict.projectedScore - verdict.score
      : null;

  const evaluatedAreaCount =
    verdict.evaluatedAreas.length + verdict.partiallyEvaluatedAreas.length;

  const showReadyMoment =
    verdict.status === "ready_to_ship" &&
    verdict.blockersCount === 0 &&
    evaluatedAreaCount > 0 &&
    showScore;

  return {
    status: verdict.status,
    headline: verdictHeadlineDisplay(verdict.status),
    statusMessage: options?.statusMessage ?? STATUS_MESSAGES[verdict.status],
    score: verdict.score,
    scoreDelta: verdict.scoreDelta,
    blockersCount: verdict.blockersCount,
    estimatedFixMinutes: verdict.estimatedFixMinutes,
    projectedScore: verdict.projectedScore,
    projectedScoreIsEstimate: verdict.projectedScoreIsEstimate,
    scoreImprovement,
    introducedBlockers: verdict.introducedBlockers,
    resolvedBlockers: verdict.resolvedBlockers,
    deltaNarrative: narrative,
    deltaDirection: direction,
    executiveSummary: verdict.executiveSummary,
    recommendedAction: verdict.recommendedAction,
    commitSha: verdict.commitSha,
    generatedAt: verdict.generatedAt,
    evaluatedAreaCount,
    coverageRatio: verdict.coverageRatio,
    filesAnalyzed: verdict.filesAnalyzed,
    showReadyMoment,
    showScore,
  };
}

export function projectSummaryCopy(verdict: ProductionVerdictV1): string {
  const view = verdictExperienceFromVerdict(verdict);
  if (!view.showScore || view.score == null) {
    return "Run a production review to get your current Production Verdict.";
  }
  if (view.projectedScore != null && view.scoreImprovement != null && view.scoreImprovement > 0) {
    return `Your application is currently ${view.score}% production ready. Resolving the next three priorities could raise it to ${view.projectedScore}.`;
  }
  return `Your application is currently ${view.score}% production ready.`;
}
