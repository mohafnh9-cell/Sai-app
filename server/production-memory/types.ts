import type { VerdictStatus } from "@/brain/production-verdict/schema";

/** Hybrid V1 event catalog (append-only). */
export const PROTECTION_EVENT_TYPES = [
  "protection_review_started",
  "protection_review_completed",
  "verdict_created",
  "deploy_readiness_checked",
  "deploy_blocked",
  "deploy_ready",
  "safe_fix_generated",
  "fix_verified",
  "recommendation_dismissed",
  "confidence_snapshot",
  "protection_milestone_reached",
  "github_push_correlated",
  "browser_simulation_requested",
  "browser_simulation_started",
  "browser_simulation_completed",
  "browser_simulation_partial",
  "browser_simulation_failed",
  "browser_simulation_cancelled",
  "browser_finding_confirmed",
  "security_decision_created",
  "security_decision_changed",
  "security_deployment_approved",
  "security_deployment_blocked",
  "security_policy_triggered",
  "security_coverage_gap",
  "security_accepted_risk",
  "api_surface_discovered",
  "api_team_completed",
  "api_replay_plan_created",
  "api_regression_detected",
  "authorization_model_built",
  "authorization_verified",
  "tenant_verified",
  "rls_verified",
  "privilege_escalation_detected",
  "authorization_fix_verified",
  "authorization_team_completed",
  "fix_strategy_generated",
  "fix_strategy_replay_failed",
  "fix_strategy_replay_verified",
  "universal_engineering_completed",
  "engineering_plan_created",
  "autonomous_orchestrator_planned",
] as const;

export type ProtectionEventType = (typeof PROTECTION_EVENT_TYPES)[number];

export type DeployAnswer = "go" | "no_go" | "not_yet";

export type ProtectionStatus =
  | "protected"
  | "safe_with_caution"
  | "requires_attention"
  | "not_protected";

export type HealthLabel = "excellent" | "good" | "needs_attention" | "at_risk";

export type ProtectionHealth = "strong" | "steady" | "at_risk" | "unwatched";

export type AppendProtectionEventInput = {
  organizationId: string;
  projectId: string;
  type: ProtectionEventType;
  payload: Record<string, unknown>;
  occurredAt?: string;
  scanId?: string | null;
  scanJobId?: string | null;
  idempotencyKey?: string | null;
};

export type ProjectMemorySummary = {
  projectId: string;
  protectedDays: number;
  protectionStartedAt: string | null;
  productionConfidenceDeltaPercent: number | null;
  securityConfidenceDeltaPercent: number | null;
  criticalIssuesFixed: number;
  unsafeDeploymentsPrevented: number;
  openRecommendations: number;
  healthTrend: "improving" | "stable" | "needs_attention" | "insufficient_data";
  headline: string;
  stackFingerprint: string[];
};

export function deployAnswerFromVerdictStatus(status: VerdictStatus): DeployAnswer {
  switch (status) {
    case "ready_to_ship":
      return "go";
    case "almost_ready":
      return "not_yet";
    case "not_ready":
    case "needs_improvement":
      return "no_go";
    default:
      return "not_yet";
  }
}

export function protectionStatusFromVerdict(status: VerdictStatus): ProtectionStatus {
  switch (status) {
    case "ready_to_ship":
      return "protected";
    case "almost_ready":
      return "safe_with_caution";
    case "not_ready":
    case "needs_improvement":
      return "requires_attention";
    default:
      return "not_protected";
  }
}

export function healthLabelFromScore(score: number | null, protectionStatus: ProtectionStatus): HealthLabel {
  if (protectionStatus === "requires_attention") {
    return score != null && score >= 70 ? "needs_attention" : "at_risk";
  }
  if (score == null) return "needs_attention";
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "needs_attention";
  return "at_risk";
}

export function compositeHealthScore(
  productionConfidence: number | null,
  securityConfidence: number | null
): number | null {
  if (productionConfidence == null && securityConfidence == null) return null;
  const prod = productionConfidence ?? securityConfidence ?? 0;
  const sec = securityConfidence ?? productionConfidence ?? 0;
  return Math.round((prod + sec) / 2);
}
