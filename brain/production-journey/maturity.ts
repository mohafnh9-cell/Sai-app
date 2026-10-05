import type { ProductionJourneyPoint, MaturityStage } from "./schema";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import type { DeploymentPosture } from "@/brain/production-verdict/deployment-posture";
import { JOURNEY_CONFIG } from "./config";
import { isValidJourneyVerdict } from "./valid-verdict";
import type { JourneyTrend } from "./schema";

export function calculateMaturity(input: {
  validReviews: number;
  currentStatus: VerdictStatus | null;
  /** Canonical posture of the current verdict. Only "ready" may reach production_ready / production_maintained. */
  currentPosture?: DeploymentPosture | null;
  currentScore: number | null;
  trend: JourneyTrend;
  blockersResolved: number;
  timeline: ProductionJourneyPoint[];
}): MaturityStage {
  if (input.validReviews === 0) return "unassessed";

  const validTimeline = input.timeline.filter((p) =>
    isValidJourneyVerdict(p.status, p.score)
  );

  // A raw ready_to_ship status is not a deployment decision: maturity only claims
  // "production ready" when the canonical posture is "ready" (high confidence, complete coverage).
  const currentlyReady = input.currentStatus === "ready_to_ship" && input.currentPosture === "ready";

  const recentReady = validTimeline
    .slice(-JOURNEY_CONFIG.maintainedReviewCount)
    .every((p) => p.status === "ready_to_ship" && p.deploymentPosture === "ready");

  const hadRegression = validTimeline.some(
    (p, index) =>
      index > 0 &&
      p.status === "not_ready" &&
      validTimeline[index - 1].status === "ready_to_ship"
  );

  if (currentlyReady && recentReady && !hadRegression) {
    return "production_maintained";
  }

  if (currentlyReady) {
    return "production_ready";
  }

  if (
    input.currentStatus === "almost_ready" ||
    // no blockers found but the evidence does not support approval: close, not "ready"
    input.currentStatus === "ready_to_ship" ||
    (input.currentScore !== null && input.currentScore >= JOURNEY_CONFIG.approachingScoreThreshold)
  ) {
    return "approaching_production";
  }

  if (
    input.validReviews >= 2 &&
    (input.blockersResolved > 0 || input.trend === "improving" || input.trend === "stable")
  ) {
    return "production_aware";
  }

  if (
    input.currentStatus === "not_ready" ||
    (input.currentScore !== null && input.currentScore < JOURNEY_CONFIG.earlyBuildScoreThreshold)
  ) {
    return "early_build";
  }

  return "production_aware";
}
