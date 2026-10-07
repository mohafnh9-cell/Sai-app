import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { ProductionJourney } from "@/brain/production-journey/schema";
import {
  type ProductionIntelligence,
  ProductionIntelligenceSchema,
  type IntelligenceEmptyState,
} from "./schema";
import { buildWhatChanged } from "./what-changed";
import { buildRecommendedAction } from "./recommended-action";
import { buildProductionInsights } from "./insights";
import { buildWeeklyReview } from "./weekly-review";

const VERSION = "1.0.0";

const MOMENTUM_EXPLANATION: Record<
  ProductionJourney["trend"],
  string
> = {
  improving: "momentum.explanationImproving",
  stable: "momentum.explanationStable",
  declining: "momentum.explanationDeclining",
  insufficient_data: "momentum.explanationInsufficient",
};

function focusExplanationKey(focusKey: string | null): string | null {
  if (!focusKey) return null;
  const suffix = focusKey.replace("focus.", "");
  return `focusExplanation.${suffix}`;
}

function resolveEmptyState(
  journey: ProductionJourney
): IntelligenceEmptyState | null {
  if (journey.validReviews === 0) return "first_review";
  if (journey.currentDeploymentPosture === "ready") return "ready_to_ship";
  if (journey.validReviews === 1) return "one_review";
  if (journey.currentBlockers === 0 && journey.validReviews >= 2) return "no_blockers";
  if (journey.trend === "improving") return "improving";
  if (journey.trend === "declining") return "declining";
  if (journey.totalReviews === 0) return "no_activity";
  return null;
}

export function buildProductionIntelligence(input: {
  journey: ProductionJourney;
  verdict: ProductionVerdictV1 | null;
}): ProductionIntelligence {
  const { journey, verdict } = input;
  const latest = journey.timeline[journey.timeline.length - 1];
  const whatChanged = buildWhatChanged(journey);
  const recommendedAction = buildRecommendedAction(journey, verdict);
  const weeklyReview = buildWeeklyReview(journey);

  if (verdict && recommendedAction.estimatedMinutes == null) {
    weeklyReview.estimatedMinutesToImprovement = verdict.estimatedFixMinutes;
  } else if (recommendedAction.estimatedMinutes != null) {
    weeklyReview.estimatedMinutesToImprovement = recommendedAction.estimatedMinutes;
  }

  const intelligence: ProductionIntelligence = {
    version: VERSION,
    projectId: journey.projectId,

    currentStatus: journey.currentStatus,
    currentScore: journey.currentScore,
    previousScore: journey.previousScore,
    scoreDelta: latest?.scoreDelta ?? null,
    bestScore: journey.bestScore,
    currentBlockers: journey.currentBlockers,

    momentum: journey.trend,
    momentumExplanationKey: MOMENTUM_EXPLANATION[journey.trend],

    whatChanged: {
      hasChanges: whatChanged.hasChanges,
      items: whatChanged.items,
    },
    improvements: whatChanged.improvements,
    regressions: whatChanged.regressions,

    recommendedAction,

    weeklyReview,

    insights: buildProductionInsights(journey),

    healthSummary: {
      currentVerdict: journey.currentStatus,
      trend: journey.trend,
      currentFocusKey: journey.currentFocusKey,
      currentMilestoneKey: journey.currentMilestone?.titleKey ?? null,
      currentBlockers: journey.currentBlockers,
      bestScore: journey.bestScore,
      latestChangeDelta: latest?.scoreDelta ?? null,
    },

    journeySummary: {
      validReviews: journey.validReviews,
      maturity: journey.maturity,
      trend: journey.trend,
      scoreChange7d: journey.scoreChange7d,
      scoreChange30d: journey.scoreChange30d,
    },

    currentFocusKey: journey.currentFocusKey,
    focusExplanationKey: focusExplanationKey(journey.currentFocusKey),

    emptyState: resolveEmptyState(journey),
  };

  return ProductionIntelligenceSchema.parse(intelligence);
}

export function toIntelligencePreview(
  intelligence: ProductionIntelligence
): import("./schema").ProductionIntelligencePreview {
  return {
    projectId: intelligence.projectId,
    currentStatus: intelligence.currentStatus,
    currentScore: intelligence.currentScore,
    scoreDelta: intelligence.scoreDelta,
    momentum: intelligence.momentum,
    recommendedAction: intelligence.recommendedAction,
    currentFocusKey: intelligence.currentFocusKey,
    emptyState: intelligence.emptyState,
  };
}
