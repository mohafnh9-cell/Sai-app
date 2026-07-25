import type { ProtectionStatusLabel, StatusEvaluationInput } from "./types";

const MS_DAY = 24 * 60 * 60 * 1000;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / MS_DAY;
}

/**
 * Deterministic protection status machine (doc 04). First matching rule wins.
 */
export function evaluateProtectionStatus(input: StatusEvaluationInput): ProtectionStatusLabel {
  if (!input.continuousProtectionEnabled || input.continuousProtectionPaused) {
    return "NOT_PROTECTED";
  }
  if (!input.githubConnected) {
    return "NOT_PROTECTED";
  }
  if (!input.hasSuccessfulReview) {
    return "NOT_PROTECTED";
  }
  if (input.consecutiveDailyFailures >= 3) {
    return "NOT_PROTECTED";
  }
  if (
    input.deployAnswer === "no_go" &&
    input.openCriticalCount > 0 &&
    input.lastCheckAt &&
    (daysSince(input.lastCheckAt) ?? 0) > 1
  ) {
    return "NOT_PROTECTED";
  }

  if (input.staleCheckWhileCpOn) {
    return "REQUIRES_ATTENTION";
  }
  if (input.materialChangeIn7d) {
    return "REQUIRES_ATTENTION";
  }
  if (input.productionConfidenceDelta7d != null && input.productionConfidenceDelta7d <= -10) {
    return "REQUIRES_ATTENTION";
  }
  if (input.securityConfidenceDelta7d != null && input.securityConfidenceDelta7d <= -10) {
    return "REQUIRES_ATTENTION";
  }
  if (input.attackSurfaceIncreased) {
    return "REQUIRES_ATTENTION";
  }
  if (input.newCriticalDependencyAdvisory) {
    return "REQUIRES_ATTENTION";
  }

  if (
    input.deployAnswer === "not_yet" ||
    input.openHighCount > 0 ||
    (input.productionConfidence != null && input.productionConfidence < 85)
  ) {
    return "SAFE_WITH_CAUTION";
  }

  return "PROTECTED";
}

export function isCheckStale(lastCheckAt: string | null, cpActive: boolean): boolean {
  if (!cpActive || !lastCheckAt) return false;
  const days = daysSince(lastCheckAt);
  return days != null && days > 7;
}
