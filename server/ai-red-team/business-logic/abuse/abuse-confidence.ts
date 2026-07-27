import type { BusinessInvariantConfidenceLevel } from "../invariants/invariant.types";
import type { BusinessAbuseConfidence } from "./abuse.types";

const INVARIANT_TO_ABUSE: Record<BusinessInvariantConfidenceLevel, BusinessAbuseConfidence> = {
  explicit: "confirmed",
  confirmed: "highly_likely",
  strongly_inferred: "likely",
  inferred: "likely",
  assumed: "possible",
  unsupported: "unsupported",
};

export function abuseConfidenceFromInvariant(
  level: BusinessInvariantConfidenceLevel,
  evidenceMax: number
): BusinessAbuseConfidence {
  const base = INVARIANT_TO_ABUSE[level];
  if (base === "unsupported") return "unsupported";
  if (evidenceMax >= 0.88 && base === "likely") return "highly_likely";
  if (evidenceMax < 0.65 && base === "possible") return "possible";
  return base;
}

export function abuseConfidenceRank(confidence: BusinessAbuseConfidence): number {
  const order: BusinessAbuseConfidence[] = [
    "confirmed",
    "highly_likely",
    "likely",
    "possible",
    "unsupported",
  ];
  return order.indexOf(confidence);
}

export function maxEvidenceConfidence(evidence: { confidence: number }[]): number {
  if (evidence.length === 0) return 0;
  return Math.max(...evidence.map((e) => e.confidence));
}
