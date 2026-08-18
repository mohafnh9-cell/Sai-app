export const CONFIDENCE_LEVELS = [
  "VERIFIED",
  "PROBABLE",
  "INFERRED",
  "SPECULATIVE",
] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export type LegacyConfidenceBand = "high" | "medium" | "low";

export type FindingVerificationStatusForConfidence =
  | "CONFIRMED"
  | "LIKELY"
  | "POTENTIAL"
  | "UNVERIFIED"
  | "NOT_REPRODUCED"
  | "FALSE_POSITIVE"
  | "NOT_APPLICABLE";

export type ConfidenceDistribution = Record<ConfidenceLevel, number>;

export function emptyConfidenceDistribution(): ConfidenceDistribution {
  return {
    VERIFIED: 0,
    PROBABLE: 0,
    INFERRED: 0,
    SPECULATIVE: 0,
  };
}

export function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return typeof value === "string" && (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}

export function parseConfidenceLevel(value: unknown): ConfidenceLevel | null {
  return isConfidenceLevel(value) ? value : null;
}
