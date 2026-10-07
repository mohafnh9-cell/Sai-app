import type { ProductionJourney } from "@/brain/production-journey/schema";
import type { ProductionInsight } from "./schema";

export function buildProductionInsights(journey: ProductionJourney): ProductionInsight[] {
  const insights: ProductionInsight[] = [];

  if (journey.validReviews >= 3 && journey.trend === "improving") {
    insights.push({
      id: "improving-three-reviews",
      messageKey: "insights.improvingLastThree",
    });
  }

  if (
    journey.maturity === "approaching_production" ||
    journey.maturity === "production_ready" ||
    journey.maturity === "production_maintained"
  ) {
    insights.push({
      id: "approaching-production",
      messageKey: "insights.approachingProduction",
    });
  }

  if (journey.currentDeploymentPosture === "ready") {
    insights.push({
      id: "ready-to-ship",
      messageKey: "insights.readyToShip",
    });
  }

  if (journey.trend === "declining" && journey.validReviews >= 2) {
    insights.push({
      id: "declining-trend",
      messageKey: "insights.decliningTrend",
    });
  }

  if (journey.blockersResolved > journey.blockersIntroduced && journey.validReviews >= 2) {
    insights.push({
      id: "net-blocker-improvement",
      messageKey: "insights.netBlockerImprovement",
      params: { net: journey.netBlockerImprovement },
    });
  }

  if (journey.bestScore != null && journey.currentScore === journey.bestScore && journey.validReviews >= 2) {
    insights.push({
      id: "at-best-score",
      messageKey: "insights.atBestScore",
      params: { score: journey.bestScore },
    });
  }

  return insights.slice(0, 4);
}
