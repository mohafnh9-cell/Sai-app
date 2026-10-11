import type { ProductionJourneyPoint, JourneyTrend } from "./schema";
import { JOURNEY_CONFIG } from "./config";
import { isEvidenceBearingVerdict } from "./valid-verdict";

function daysAgoMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

function scoreAtOrBefore(
  points: ProductionJourneyPoint[],
  cutoff: Date
): number | null {
  const eligible = points
    .filter((p) => isEvidenceBearingVerdict(p.status, p.score) && new Date(p.generatedAt) <= cutoff)
    .map((p) => p.score as number);
  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

export function calculateScoreChange(
  timeline: ProductionJourneyPoint[],
  days: number
): number | null {
  const valid = timeline.filter((p) => isEvidenceBearingVerdict(p.status, p.score));
  if (valid.length < 2) return null;

  const now = new Date(valid[valid.length - 1].generatedAt).getTime();
  const cutoff = new Date(now - daysAgoMs(days));
  const baseline = scoreAtOrBefore(valid, cutoff);
  const current = valid[valid.length - 1].score;
  if (baseline === null || current === null) return null;
  return current - baseline;
}

export function calculateTrend(timeline: ProductionJourneyPoint[]): JourneyTrend {
  const valid = timeline.filter((p) => isEvidenceBearingVerdict(p.status, p.score));

  if (valid.length < JOURNEY_CONFIG.minValidVerdictsForTrend) {
    return "insufficient_data";
  }

  const scores = valid.map((p) => p.score as number);
  const recent = scores.slice(-3);
  const prior = scores.slice(-6, -3);

  const recentAvg =
    recent.reduce((sum, value) => sum + value, 0) / Math.max(recent.length, 1);
  const priorAvg =
    prior.length > 0
      ? prior.reduce((sum, value) => sum + value, 0) / prior.length
      : recentAvg;

  const avgDelta = recentAvg - priorAvg;

  const window = valid.slice(-5);
  const introduced = window.reduce((sum, p) => sum + p.introducedBlockersCount, 0);
  const resolved = window.reduce((sum, p) => sum + p.resolvedBlockersCount, 0);

  const statusRegression = window.some(
    (p, index) =>
      index > 0 &&
      p.status === "needs_improvement" &&
      window[index - 1].status === "almost_ready"
  );

  if (
    avgDelta <= JOURNEY_CONFIG.decliningScoreDeltaThreshold ||
    (introduced > resolved + 1 && avgDelta < 0) ||
    statusRegression
  ) {
    return "declining";
  }

  if (
    avgDelta >= JOURNEY_CONFIG.improvingScoreDeltaThreshold ||
    (resolved > introduced && avgDelta > 0)
  ) {
    return "improving";
  }

  if (Math.abs(avgDelta) <= JOURNEY_CONFIG.stableScoreDeltaThreshold) {
    return "stable";
  }

  return avgDelta > 0 ? "improving" : "declining";
}
