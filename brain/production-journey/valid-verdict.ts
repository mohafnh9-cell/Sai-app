import type { VerdictStatus } from "@/brain/production-verdict/schema";

export function isValidJourneyVerdict(status: VerdictStatus, score: number | null): boolean {
  if (status === "analysis_failed") return false;
  if (score === null) return false;
  return true;
}

export function isChartableVerdict(status: VerdictStatus, score: number | null): boolean {
  return isValidJourneyVerdict(status, score);
}

/**
 * A verdict that carries evidence. `insufficient_data` keeps a placeholder score (it is hidden everywhere a score is
 * shown, see `shouldShowScore`): such a point must not move a trend, a score change or a "reached score" milestone.
 */
export function isEvidenceBearingVerdict(status: VerdictStatus, score: number | null): boolean {
  return isValidJourneyVerdict(status, score) && status !== "insufficient_data";
}
