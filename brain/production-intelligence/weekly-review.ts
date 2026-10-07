import type { ProductionJourney } from "@/brain/production-journey/schema";
import type { WeeklyPeriodSummary } from "./schema";
import { isValidJourneyVerdict } from "@/brain/production-journey/valid-verdict";

function daysAgoMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

function summarizePeriod(
  journey: ProductionJourney,
  days: number
): WeeklyPeriodSummary {
  const valid = journey.timeline.filter((p) =>
    isValidJourneyVerdict(p.status, p.score)
  );
  if (valid.length === 0) {
    return { scoreChange: null, blockersResolved: 0, blockersIntroduced: 0 };
  }

  const latestAt = new Date(valid[valid.length - 1].generatedAt).getTime();
  const cutoff = latestAt - daysAgoMs(days);

  const inWindow = journey.timeline.filter(
    (p) => new Date(p.generatedAt).getTime() >= cutoff
  );

  const blockersResolved = inWindow.reduce(
    (sum, p) => sum + p.resolvedBlockersCount,
    0
  );
  const blockersIntroduced = inWindow.reduce(
    (sum, p) => sum + p.introducedBlockersCount,
    0
  );

  const scoreChange = days === 7 ? journey.scoreChange7d : journey.scoreChange30d;

  return { scoreChange, blockersResolved, blockersIntroduced };
}

export function buildWeeklyReview(journey: ProductionJourney) {
  return {
    period7d: summarizePeriod(journey, 7),
    period30d: summarizePeriod(journey, 30),
    currentFocusKey: journey.currentFocusKey,
    estimatedMinutesToImprovement:
      journey.currentDeploymentPosture === "ready" ? 0 : null,
  };
}
