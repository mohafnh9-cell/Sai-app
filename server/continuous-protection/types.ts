/** User-facing protection status (Protection Center + doc 04). */
export const PROTECTION_STATUSES = [
  "PROTECTED",
  "SAFE_WITH_CAUTION",
  "REQUIRES_ATTENTION",
  "NOT_PROTECTED",
] as const;

export type ProtectionStatusLabel = (typeof PROTECTION_STATUSES)[number];

/** Stored on snapshots / weekly rows (snake_case). */
export type ProtectionStatusStorage =
  | "protected"
  | "safe_with_caution"
  | "requires_attention"
  | "not_protected";

export type ProtectionHealthBand = "strong" | "steady" | "at_risk" | "unwatched";

export type HealthLabel = "excellent" | "good" | "needs_attention" | "at_risk";

export type StatusEvaluationInput = {
  continuousProtectionEnabled: boolean;
  continuousProtectionPaused: boolean;
  githubConnected: boolean;
  hasSuccessfulReview: boolean;
  lastCheckAt: string | null;
  consecutiveDailyFailures: number;
  deployAnswer: "go" | "no_go" | "not_yet" | null;
  openCriticalCount: number;
  openHighCount: number;
  productionConfidence: number | null;
  securityConfidence: number | null;
  productionConfidenceDelta7d: number | null;
  securityConfidenceDelta7d: number | null;
  materialChangeIn7d: boolean;
  attackSurfaceIncreased: boolean;
  newCriticalDependencyAdvisory: boolean;
  staleCheckWhileCpOn: boolean;
};

export function storageFromLabel(label: ProtectionStatusLabel): ProtectionStatusStorage {
  switch (label) {
    case "PROTECTED":
      return "protected";
    case "SAFE_WITH_CAUTION":
      return "safe_with_caution";
    case "REQUIRES_ATTENTION":
      return "requires_attention";
    default:
      return "not_protected";
  }
}

export function labelFromStorage(value: ProtectionStatusStorage): ProtectionStatusLabel {
  switch (value) {
    case "protected":
      return "PROTECTED";
    case "safe_with_caution":
      return "SAFE_WITH_CAUTION";
    case "requires_attention":
      return "REQUIRES_ATTENTION";
    default:
      return "NOT_PROTECTED";
  }
}

export function protectionHealthFromStatus(label: ProtectionStatusLabel): ProtectionHealthBand {
  switch (label) {
    case "PROTECTED":
      return "strong";
    case "SAFE_WITH_CAUTION":
      return "steady";
    case "REQUIRES_ATTENTION":
      return "at_risk";
    default:
      return "unwatched";
  }
}

export function statusHeadline(label: ProtectionStatusLabel): string {
  switch (label) {
    case "PROTECTED":
      return "Your application is protected.";
    case "SAFE_WITH_CAUTION":
      return "Protected, but I'm watching a few things.";
    case "REQUIRES_ATTENTION":
      return "Something needs your attention.";
    default:
      return "Your application is not protected yet.";
  }
}
