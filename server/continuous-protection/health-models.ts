import type { HealthLabel, ProtectionStatusLabel } from "./types";
import { protectionHealthFromStatus } from "./types";

export type HealthComputationInput = {
  productionConfidence: number | null;
  securityConfidence: number | null;
  lastCheckAt: string | null;
  openCriticalHighCount: number;
  protectionStatus: ProtectionStatusLabel;
};

const MS_DAY = 24 * 60 * 60 * 1000;

function recencyFactor(lastCheckAt: string | null): number {
  if (!lastCheckAt) return 0.5;
  const days = (Date.now() - new Date(lastCheckAt).getTime()) / MS_DAY;
  if (days <= 7) return 1;
  if (days <= 14) return 0.7;
  return 0.4;
}

function pressureFactor(openCriticalHighCount: number): number {
  if (openCriticalHighCount === 0) return 1;
  if (openCriticalHighCount <= 2) return 0.85;
  return 0.65;
}

/** Production Health Score 0–100 (doc 05 weights). */
export function computeProductionHealthScore(input: HealthComputationInput): number | null {
  const prod = input.productionConfidence;
  const sec = input.securityConfidence;
  if (prod == null && sec == null) return null;

  const production = prod ?? sec ?? 0;
  const security = sec ?? prod ?? 0;
  const base = production * 0.35 + security * 0.35;
  const recency = 100 * 0.15 * recencyFactor(input.lastCheckAt);
  const pressure = 100 * 0.15 * pressureFactor(input.openCriticalHighCount);
  return Math.round(Math.min(100, Math.max(0, base + recency + pressure)));
}

export function healthLabelFromScore(
  score: number | null,
  protectionStatus: ProtectionStatusLabel
): HealthLabel {
  if (protectionStatus === "REQUIRES_ATTENTION") {
    return score != null && score >= 70 ? "needs_attention" : "at_risk";
  }
  if (score == null) return "needs_attention";
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "needs_attention";
  return "at_risk";
}

export function computeHealthBundle(input: HealthComputationInput) {
  const healthScore = computeProductionHealthScore(input);
  const healthLabel = healthLabelFromScore(healthScore, input.protectionStatus);
  const protectionHealth = protectionHealthFromStatus(input.protectionStatus);

  const productionHealth = healthLabelFromScore(input.productionConfidence, input.protectionStatus);
  const securityHealth = healthLabelFromScore(input.securityConfidence, input.protectionStatus);

  return {
    healthScore,
    healthLabel,
    protectionHealth,
    productionHealth,
    securityHealth,
  };
}

export type ConfidenceTrendPoint = {
  date: string;
  productionConfidence: number | null;
  securityConfidence: number | null;
  healthScore: number | null;
};

export function confidenceTrendNarrative(
  productionDelta: number | null,
  securityDelta: number | null
): string {
  if (productionDelta == null && securityDelta == null) {
    return "Steady week — confidence held.";
  }
  const prodDown = productionDelta != null && productionDelta <= -10;
  const secDown = securityDelta != null && securityDelta <= -10;
  const prodUp = productionDelta != null && productionDelta >= 5;
  const secUp = securityDelta != null && securityDelta >= 5;
  if (prodDown || secDown) {
    return "Something eroded trust this week — see what changed.";
  }
  if (prodUp && secUp) {
    return "Production confidence is increasing — nice work.";
  }
  if (prodUp || secUp) {
    return "Confidence improved this week.";
  }
  return "Steady week — nothing material moved.";
}
