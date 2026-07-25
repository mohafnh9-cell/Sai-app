import type { SafeFixConfidenceBand } from "./types";
import { assessSafeFix, type ImplementationRisk } from "@/brain/fix-prompt/assessment";
import type { ProductionFixPromptInput } from "@/brain/fix-prompt/types";

/** Deterministic band from engine score + diagnosis signals (Sprint 7). */
export function calculateSafeFixConfidence(input: {
  confidenceScore: number;
  implementationRisk: ImplementationRisk;
  affectedFileCount: number;
  hasRecommendedAction: boolean;
  historicalSuccessRate?: number | null;
}): { band: SafeFixConfidenceBand; score: number; factors: string[] } {
  let score = input.confidenceScore;
  const factors: string[] = [];

  if (input.affectedFileCount === 1) {
    score += 2;
    factors.push("single_file_locality");
  } else if (input.affectedFileCount >= 4) {
    score -= 4;
    factors.push("wide_blast_radius");
  }

  if (input.implementationRisk === "HIGH") {
    score -= 6;
    factors.push("high_side_effect_risk");
  } else if (input.implementationRisk === "LOW") {
    score += 3;
    factors.push("low_implementation_risk");
  }

  if (!input.hasRecommendedAction) {
    score -= 8;
    factors.push("uncertain_diagnosis");
  } else {
    factors.push("clear_recommended_action");
  }

  if (input.historicalSuccessRate != null && input.historicalSuccessRate >= 0.8) {
    score += 2;
    factors.push("strong_historical_success");
  }

  score = Math.max(70, Math.min(98, Math.round(score)));

  let band: SafeFixConfidenceBand = "LOW";
  if (score >= 94) band = "VERY_HIGH";
  else if (score >= 88) band = "HIGH";
  else if (score >= 80) band = "MEDIUM";

  return { band, score, factors };
}

export function bandFromScore(score: number): SafeFixConfidenceBand {
  if (score >= 94) return "VERY_HIGH";
  if (score >= 88) return "HIGH";
  if (score >= 80) return "MEDIUM";
  return "LOW";
}

export function trustNarrativeForBand(band: SafeFixConfidenceBand): string {
  switch (band) {
    case "VERY_HIGH":
      return "I would trust this fix before your next deploy.";
    case "HIGH":
      return "This is a solid fix — review the checklist, then apply.";
    case "MEDIUM":
      return "Reasonable fix — validate carefully in staging.";
    default:
      return "Proceed cautiously — consider a fresh review after applying.";
  }
}

export function historicalSuccessRate(
  verified: number,
  failed: number
): number | null {
  const total = verified + failed;
  if (total === 0) return null;
  return verified / total;
}

export function confidenceFromPromptInput(input: ProductionFixPromptInput): number {
  return assessSafeFix(input).safeFixConfidence;
}
