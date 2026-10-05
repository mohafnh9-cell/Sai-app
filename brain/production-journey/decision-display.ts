import type { DeploymentPosture } from "@/brain/production-verdict/deployment-posture";
import type { MaturityStage, ProductionJourney } from "./schema";

/**
 * What the Production Journey may say about the CURRENT deployment decision.
 * Derived only from the canonical posture of the latest verdict, plus whether a review
 * is running (then there is no final decision for the current run).
 */
export type JourneyPostureKey = DeploymentPosture | "analysis_in_progress" | "no_decision";

export function journeyPostureKey(
  journey: Pick<ProductionJourney, "currentDeploymentPosture">,
  reviewInProgress: boolean
): JourneyPostureKey {
  if (reviewInProgress) return "analysis_in_progress";
  return journey.currentDeploymentPosture ?? "no_decision";
}

/** Maturity label key; while a review runs the old maturity must not be presented as the current state. */
export function journeyMaturityKey(
  journey: Pick<ProductionJourney, "maturity">,
  reviewInProgress: boolean
): MaturityStage | "analysis_in_progress" {
  return reviewInProgress ? "analysis_in_progress" : journey.maturity;
}
