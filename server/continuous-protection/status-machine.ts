import type { ProtectionStatusLabel, StatusEvaluationInput } from "./types";

const MS_DAY = 24 * 60 * 60 * 1000;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / MS_DAY;
}

/**
 * Operational protection status (doc 04). First matching rule wins. The
 * security posture is the canonical Production Verdict's (`input.decision`).
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

  // Security posture comes from the canonical verdict, never from this machine.
  // Without a completed current verdict there is no decision to protect on.
  if (input.decision.state !== "verdict") {
    return "NOT_PROTECTED";
  }
  // "PROTECTED" is a positive claim: only when the canonical gate affirms it
  // (ready_to_ship AND high confidence AND complete coverage). Every other
  // posture -- no blockers but limited evidence, more analysis required, not
  // ready -- needs attention. SAFE_WITH_CAUTION is no longer produced: it was a
  // second, independent safety judgement.
  return input.decision.posture === "ready" ? "PROTECTED" : "REQUIRES_ATTENTION";
}

export function isCheckStale(lastCheckAt: string | null, cpActive: boolean): boolean {
  if (!cpActive || !lastCheckAt) return false;
  const days = daysSince(lastCheckAt);
  return days != null && days > 7;
}
