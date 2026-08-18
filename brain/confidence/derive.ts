import type { DetectionMethod } from "@/brain/evidence-finding/schema";
import { computeConfidenceScore } from "@/brain/evidence-finding/compute-confidence";
import type { EvidenceItem } from "@/brain/evidence-finding/schema";
import { enforceAllowedConfidence } from "./invariants";
import type {
  ConfidenceDistribution,
  ConfidenceLevel,
  FindingVerificationStatusForConfidence,
  LegacyConfidenceBand,
} from "./types";
import { emptyConfidenceDistribution, isConfidenceLevel } from "./types";

export type DeriveConfidenceInput = {
  numericScore?: number | null;
  detectionMethod?: DetectionMethod | null;
  evidenceItems?: EvidenceItem[];
  severity?: string | null;
  hasRuntimeEvidence?: boolean;
  hasReplayEvidence?: boolean;
  signalHits?: number;
  legacyBand?: LegacyConfidenceBand | string | null;
  legacyExternal?: "HIGH" | "MEDIUM" | "LOW" | string | null;
  verificationStatus?: FindingVerificationStatusForConfidence | null;
  llmOnly?: boolean;
  suppressed?: boolean;
};

export const CONFIDENCE_LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  VERIFIED: "Verified",
  PROBABLE: "Probable",
  INFERRED: "Inferred",
  SPECULATIVE: "Speculative",
};

export function confidenceLevelFromNumericScore(
  score: number,
  context?: Pick<
    DeriveConfidenceInput,
    "hasRuntimeEvidence" | "hasReplayEvidence" | "detectionMethod" | "llmOnly" | "suppressed"
  >
): ConfidenceLevel {
  const clamped = Math.min(0.99, Math.max(0.05, score));

  if (context?.suppressed) return "SPECULATIVE";
  if (context?.llmOnly && !context.hasRuntimeEvidence) return "SPECULATIVE";

  if (
    context?.hasRuntimeEvidence &&
    (context.detectionMethod === "LIVE_VERIFICATION" ||
      context.detectionMethod === "AUTHORIZED_STAGING" ||
      context.detectionMethod === "DYNAMIC_ANALYSIS" ||
      clamped >= 0.88)
  ) {
    return "VERIFIED";
  }

  if (context?.hasReplayEvidence || clamped >= 0.75) return "PROBABLE";
  if (clamped >= 0.55) return "INFERRED";
  return "SPECULATIVE";
}

export function confidenceLevelFromLegacyBand(
  band: LegacyConfidenceBand | string | null | undefined,
  context?: Pick<DeriveConfidenceInput, "hasRuntimeEvidence" | "verificationStatus">
): ConfidenceLevel {
  const normalized = String(band ?? "medium").toLowerCase();
  if (context?.verificationStatus === "CONFIRMED") return "VERIFIED";
  if (context?.hasRuntimeEvidence && normalized === "high") return "VERIFIED";
  if (normalized === "high") return "PROBABLE";
  if (normalized === "medium") return "INFERRED";
  return "SPECULATIVE";
}

export function confidenceLevelFromExternalLabel(
  label: "HIGH" | "MEDIUM" | "LOW" | string | null | undefined
): ConfidenceLevel {
  const normalized = String(label ?? "MEDIUM").toUpperCase();
  if (normalized === "HIGH") return "PROBABLE";
  if (normalized === "MEDIUM") return "INFERRED";
  return "SPECULATIVE";
}

export function deriveConfidenceLevel(input: DeriveConfidenceInput): ConfidenceLevel {
  let proposed: ConfidenceLevel;

  if (input.verificationStatus === "CONFIRMED") {
    proposed = "VERIFIED";
  } else if (input.numericScore != null && Number.isFinite(input.numericScore)) {
    proposed = confidenceLevelFromNumericScore(input.numericScore, input);
  } else if (input.legacyExternal) {
    proposed = confidenceLevelFromExternalLabel(input.legacyExternal);
  } else if (input.legacyBand) {
    proposed = confidenceLevelFromLegacyBand(input.legacyBand, input);
  } else if (input.detectionMethod) {
    const computed = computeConfidenceScore({
      detectionMethod: input.detectionMethod,
      evidenceItems: input.evidenceItems ?? [],
      severity: input.severity ?? "medium",
      hasRuntimeEvidence: Boolean(input.hasRuntimeEvidence),
      hasReplayEvidence: Boolean(input.hasReplayEvidence),
      signalHits: input.signalHits,
    });
    proposed = confidenceLevelFromNumericScore(computed.confidence, input);
  } else {
    proposed = "INFERRED";
  }

  return enforceAllowedConfidence(input.verificationStatus ?? null, proposed);
}

export function deriveConfidenceFromEvidenceScore(input: {
  detectionMethod: DetectionMethod;
  evidenceItems: EvidenceItem[];
  severity: string;
  hasRuntimeEvidence?: boolean;
  hasReplayEvidence?: boolean;
  signalHits?: number;
  verificationStatus?: FindingVerificationStatusForConfidence | null;
  suppressed?: boolean;
  llmOnly?: boolean;
}): { level: ConfidenceLevel; numericScore: number; explanation: string } {
  const { confidence, explanation } = computeConfidenceScore({
    detectionMethod: input.detectionMethod,
    evidenceItems: input.evidenceItems,
    severity: input.severity,
    hasRuntimeEvidence: Boolean(input.hasRuntimeEvidence),
    hasReplayEvidence: Boolean(input.hasReplayEvidence),
    signalHits: input.signalHits,
  });

  const level = deriveConfidenceLevel({
    numericScore: confidence,
    detectionMethod: input.detectionMethod,
    evidenceItems: input.evidenceItems,
    severity: input.severity,
    hasRuntimeEvidence: input.hasRuntimeEvidence,
    hasReplayEvidence: input.hasReplayEvidence,
    signalHits: input.signalHits,
    verificationStatus: input.verificationStatus,
    suppressed: input.suppressed,
    llmOnly: input.llmOnly,
  });

  return { level, numericScore: confidence, explanation };
}

export function legacyBandFromConfidenceLevel(level: ConfidenceLevel): LegacyConfidenceBand {
  if (level === "VERIFIED" || level === "PROBABLE") return "high";
  if (level === "INFERRED") return "medium";
  return "low";
}

export function isHighConfidenceLevel(level: ConfidenceLevel): boolean {
  return level === "VERIFIED" || level === "PROBABLE";
}

export function isVerifiedConfidenceLevel(level: ConfidenceLevel): boolean {
  return level === "VERIFIED";
}

export function summarizeConfidenceDistribution(
  levels: readonly ConfidenceLevel[]
): ConfidenceDistribution {
  const summary = emptyConfidenceDistribution();
  for (const level of levels) {
    summary[level] += 1;
  }
  return summary;
}

export function formatConfidenceDistribution(summary: ConfidenceDistribution): string {
  return (Object.entries(summary) as Array<[ConfidenceLevel, number]>)
    .filter(([, count]) => count > 0)
    .map(([level, count]) => `${count} ${CONFIDENCE_LEVEL_LABELS[level]}`)
    .join(", ");
}

export function coerceConfidenceLevel(
  value: unknown,
  fallback: DeriveConfidenceInput = {}
): ConfidenceLevel {
  if (isConfidenceLevel(value)) {
    return enforceAllowedConfidence(fallback.verificationStatus ?? null, value);
  }
  return deriveConfidenceLevel(fallback);
}
