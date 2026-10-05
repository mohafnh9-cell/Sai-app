import type { ProtectionStatusLabel } from "@/server/continuous-protection/types";
import type { ProtectionDecision } from "@/brain/production-verdict/protection-decision";
import type { SafeFixOffer } from "@/brain/production-verdict/safe-fix-eligibility";

/** Client-safe snapshot returned by GET /api/projects/[id]/protection-center */
export type ProtectionCenterSnapshot = {
  projectId: string;
  status: ProtectionStatusLabel;
  /** Projection of the canonical Production Verdict; the panel never decides safety on its own. */
  decision: ProtectionDecision;
  /** Present only when a real, current, supported finding exists. */
  safeFix: SafeFixOffer | null;
  statusHeadline: string;
  productionConfidence: number | null;
  securityConfidence: number | null;
  healthScore: number | null;
  healthLabel: string | null;
  protectionHealth: string | null;
  productionHealth: string | null;
  securityHealth: string | null;
  worriesTop3: string[];
  recommendation: string;
  lastCheckedAt: string | null;
  continuousProtectionEnabled: boolean;
  continuousProtectionPaused: boolean;
  confidenceTrend30d: Array<{
    date: string;
    productionConfidence: number | null;
    securityConfidence: number | null;
    healthScore: number | null;
  }>;
  weeklySummaryPreview: {
    weekStart: string;
    narrative: string;
    checksCompleted: number;
    productionDelta: number | null;
    securityDelta: number | null;
    trendNarrative: string;
  } | null;
};

export function protectionStatusTone(status: ProtectionStatusLabel): string {
  switch (status) {
    case "PROTECTED":
      return "border-emerald-500/30 bg-emerald-500/5";
    case "SAFE_WITH_CAUTION":
      return "border-amber-500/30 bg-amber-500/5";
    case "REQUIRES_ATTENTION":
      return "border-orange-500/30 bg-orange-500/5";
    default:
      return "border-border/60 bg-card/40";
  }
}

export function protectionStatusAccent(status: ProtectionStatusLabel): string {
  switch (status) {
    case "PROTECTED":
      return "text-brand-success";
    case "SAFE_WITH_CAUTION":
      return "text-brand-warning";
    case "REQUIRES_ATTENTION":
      return "text-orange-400";
    default:
      return "text-muted-foreground";
  }
}

/** i18n key suffix of the headline for a decision: the canonical posture, or the non-decision state. */
export function protectionDecisionKey(decision: ProtectionDecision): string {
  return decision.state === "verdict" ? decision.posture : decision.state;
}

export function protectionDecisionTone(decision: ProtectionDecision): string {
  if (decision.state !== "verdict") return "border-border/60 bg-card/40";
  switch (decision.posture) {
    case "ready":
      return "border-emerald-500/30 bg-emerald-500/5";
    case "not_ready":
      return "border-red-500/30 bg-red-500/5";
    default:
      return "border-amber-500/30 bg-amber-500/5";
  }
}

export function protectionDecisionAccent(decision: ProtectionDecision): string {
  if (decision.state !== "verdict") return "text-muted-foreground";
  switch (decision.posture) {
    case "ready":
      return "text-brand-success";
    case "not_ready":
      return "text-red-400";
    default:
      return "text-brand-warning";
  }
}
