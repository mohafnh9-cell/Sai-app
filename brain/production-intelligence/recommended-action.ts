import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { ProductionJourney } from "@/brain/production-journey/schema";
import type { RecommendedAction } from "./schema";

export function buildRecommendedAction(
  journey: ProductionJourney,
  verdict: ProductionVerdictV1 | null
): RecommendedAction {
  if (journey.validReviews === 0) {
    return {
      type: "run_review",
      titleKey: "recommendedAction.runFirstReview",
      descriptionKey: "recommendedAction.runFirstReviewDescription",
      priorityTitle: null,
      estimatedMinutes: null,
      ctaKey: "recommendedAction.runReviewCta",
    };
  }

  if (journey.validReviews === 1) {
    return {
      type: "run_review",
      titleKey: "recommendedAction.completeAnotherReview",
      descriptionKey: "recommendedAction.completeAnotherReviewDescription",
      priorityTitle: null,
      estimatedMinutes: null,
      ctaKey: "recommendedAction.runReviewCta",
    };
  }

  if (journey.currentDeploymentPosture === "ready") {
    return {
      type: "maintain",
      titleKey: "recommendedAction.maintainReadiness",
      descriptionKey: "recommendedAction.maintainReadinessDescription",
      priorityTitle: null,
      estimatedMinutes: null,
      ctaKey: null,
    };
  }

  const top = verdict?.topPriorities[0];
  if (top) {
    return {
      type: "fix_blocker",
      titleKey: "recommendedAction.fixPriority",
      descriptionKey: "recommendedAction.fixPriorityDescription",
      priorityTitle: top.title,
      estimatedMinutes: top.estimatedMinutes,
      ctaKey: "recommendedAction.viewReportCta",
    };
  }

  if (journey.currentFocusKey) {
    return {
      type: "focus_area",
      titleKey: "recommendedAction.improveFocus",
      descriptionKey: "recommendedAction.improveFocusDescription",
      priorityTitle: null,
      estimatedMinutes: verdict?.estimatedFixMinutes ?? null,
      ctaKey: "recommendedAction.viewJourneyCta",
    };
  }

  if (verdict?.recommendedAction) {
    return {
      type: "fix_blocker",
      titleKey: "recommendedAction.custom",
      descriptionKey: "recommendedAction.customDescription",
      priorityTitle: verdict.recommendedAction,
      estimatedMinutes: verdict.estimatedFixMinutes,
      ctaKey: "recommendedAction.viewReportCta",
    };
  }

  return {
    type: "run_review",
    titleKey: "recommendedAction.completeAnotherReview",
    descriptionKey: "recommendedAction.completeAnotherReviewDescription",
    priorityTitle: null,
    estimatedMinutes: null,
    ctaKey: "recommendedAction.runReviewCta",
  };
}
