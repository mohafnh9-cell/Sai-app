/** Founder-facing severity (Sprint 5). */
export const ALERT_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export type AlertDeliveryTier = "immediate" | "digest";

export type AlertState = "delivered" | "read" | "resolved" | "dismissed";

export type AlertKind =
  | "material_finding_critical"
  | "material_finding_high"
  | "confidence_cliff"
  | "dependency_critical_new"
  | "protection_status_regression"
  | "watch_stale"
  | "check_delayed"
  | "github_disconnected"
  | "protection_paused"
  | "deploy_blocked"
  | "unsafe_deployment_detected"
  | "critical_recommendation_detected"
  | "production_confidence_drop"
  | "security_confidence_drop";

export type AlertCtaType =
  | "safe_fix"
  | "review_again"
  | "open_protection"
  | "reconnect_github"
  | "resume_cp";

export type AlertCandidate = {
  alertKind: AlertKind;
  severity: AlertSeverity;
  deliveryTier: AlertDeliveryTier;
  dedupeKey: string;
  priority: number;
  protectionImpact: string;
  titlePlain: string;
  bodyPlain: string;
  worryLine: string;
  changedBullets: string[];
  nextAction: string;
  ctaType: AlertCtaType | null;
  linkedRecommendationId?: string | null;
  cooldownHours?: number;
};

export type FounderAlertRecord = {
  id: string;
  projectId: string;
  alertKind: AlertKind;
  severity: AlertSeverity;
  deliveryTier: AlertDeliveryTier;
  state: AlertState;
  titlePlain: string;
  bodyPlain: string;
  worryLine: string;
  changedBullets: string[];
  nextAction: string;
  ctaType: AlertCtaType | null;
  protectionImpact: string;
  createdAt: string;
  readAt: string | null;
  acknowledgedAt: string | null;
};
