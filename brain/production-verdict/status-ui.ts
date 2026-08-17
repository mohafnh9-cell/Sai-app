import type { VerdictStatus } from "./schema";
import { VERDICT_STATUS_LABELS } from "./schema";
import { recommendedAction as deterministicRecommendedAction } from "./status-rules";
import { verdictSurfaceClass } from "@/lib/design-system/verdict";

export type VerdictBadgeVariant = "default" | "secondary" | "outline" | "destructive";

export const VERDICT_STATUS_DESCRIPTIONS: Record<VerdictStatus, string> = {
  ready_to_ship: "No production blockers. Meets the current readiness threshold.",
  almost_ready: "Close to shipping. Resolve remaining blockers on your fastest path forward.",
  needs_improvement: "Improvements required before production deployment.",
  not_ready: "Production blockers prevent safe deployment.",
  insufficient_data: "Not enough repository coverage for a responsible production decision.",
  analysis_failed: "The latest analysis did not complete successfully.",
};

export function verdictLabel(status: VerdictStatus): string {
  return VERDICT_STATUS_LABELS[status];
}

export function verdictDescription(status: VerdictStatus): string {
  return VERDICT_STATUS_DESCRIPTIONS[status];
}

export function verdictBadgeVariant(status: VerdictStatus): VerdictBadgeVariant {
  switch (status) {
    case "ready_to_ship":
      return "default";
    case "almost_ready":
      return "secondary";
    case "needs_improvement":
      return "outline";
    case "not_ready":
    case "analysis_failed":
      return "destructive";
    case "insufficient_data":
      return "outline";
  }
}

export function verdictHeadlineDisplay(status: VerdictStatus): string {
  switch (status) {
    case "ready_to_ship":
      return "READY TO SHIP";
    case "almost_ready":
      return "ALMOST READY";
    case "needs_improvement":
      return "NEEDS IMPROVEMENT";
    case "not_ready":
      return "NOT READY TO SHIP";
    case "insufficient_data":
      return "MORE ANALYSIS REQUIRED";
    case "analysis_failed":
      return "ANALYSIS FAILED";
  }
}

export function verdictToneClass(status: VerdictStatus): string {
  return verdictSurfaceClass(status);
}

export function verdictRecommendedAction(status: VerdictStatus, blockersCount: number): string {
  return deterministicRecommendedAction(status, blockersCount);
}

export function displayScore(score: number | null): string {
  return score === null ? "—" : String(score);
}

export function shouldShowScore(score: number | null, status: VerdictStatus): boolean {
  return score !== null && status !== "insufficient_data" && status !== "analysis_failed";
}

/** @deprecated Map legacy project status to v1 for migration only */
export function legacyStatusToV1(
  legacy:
    | "ready_for_production"
    | "almost_ready"
    | "needs_improvements"
    | "not_ready"
    | "not_scanned"
): VerdictStatus {
  switch (legacy) {
    case "ready_for_production":
      return "ready_to_ship";
    case "almost_ready":
      return "almost_ready";
    case "needs_improvements":
      return "needs_improvement";
    case "not_ready":
      return "not_ready";
    case "not_scanned":
      return "insufficient_data";
  }
}
