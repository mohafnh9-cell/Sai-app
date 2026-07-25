import type { AlertKind, AlertSeverity } from "./types";

export type SeverityProfile = {
  priority: number;
  deliveryTier: "immediate" | "digest";
  protectionImpact: string;
  founderWorryLine: string;
  founderAction: string;
};

const PROFILES: Record<AlertSeverity, Omit<SeverityProfile, "deliveryTier">> = {
  critical: {
    priority: 10,
    protectionImpact: "Protection is at risk until you act.",
    founderWorryLine: "Yes — I'd stop and fix this before shipping.",
    founderAction: "Apply Safe Fix, then ask SequrAI to review again.",
  },
  high: {
    priority: 30,
    protectionImpact: "I'm less comfortable protecting this build as-is.",
    founderWorryLine: "You should address this soon — I'm not fully comfortable yet.",
    founderAction: "Apply Safe Fix or run a fresh protection review.",
  },
  medium: {
    priority: 60,
    protectionImpact: "Worth fixing before your next deploy.",
    founderWorryLine: "Not an emergency — but let's not ignore the pattern.",
    founderAction: "Plan a fix this week; ask SequrAI what changed.",
  },
  low: {
    priority: 90,
    protectionImpact: "Logged for context — no interrupt needed.",
    founderWorryLine: "Nothing urgent right now.",
    founderAction: "Keep building; check Protection Center when you ship.",
  },
};

export function severityProfile(severity: AlertSeverity): SeverityProfile {
  const base = PROFILES[severity];
  return {
    ...base,
    deliveryTier: severity === "critical" || severity === "high" ? "immediate" : "digest",
  };
}

/** Default severity per Hybrid V1 alert kind (doc 02 + Sprint 5 four-level model). */
export function defaultSeverityForKind(kind: AlertKind): AlertSeverity {
  switch (kind) {
    case "material_finding_critical":
    case "confidence_cliff":
    case "unsafe_deployment_detected":
      return "critical";
    case "material_finding_high":
    case "dependency_critical_new":
    case "protection_status_regression":
    case "watch_stale":
    case "check_delayed":
    case "github_disconnected":
    case "protection_paused":
    case "production_confidence_drop":
    case "security_confidence_drop":
    case "critical_recommendation_detected":
      return "high";
    case "deploy_blocked":
      return "medium";
    default:
      return "medium";
  }
}

export function founderLabelForSeverity(severity: AlertSeverity): string {
  switch (severity) {
    case "critical":
      return "Needs attention now";
    case "high":
      return "Before your next deploy";
    case "medium":
      return "Worth knowing this week";
    default:
      return "For your notes";
  }
}
