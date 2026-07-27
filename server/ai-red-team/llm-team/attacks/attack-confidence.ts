import type { AIInvariantConfidence } from "../invariants/invariant.types";
import type { AIAttackConfidence } from "./attack.types";

const INVARIANT_TO_ATTACK: Record<AIInvariantConfidence, AIAttackConfidence> = {
  explicit: "confirmed",
  confirmed: "highly_likely",
  strongly_inferred: "likely",
  inferred: "likely",
  assumed: "possible",
  unsupported: "unsupported",
};

export function attackConfidenceFromInvariant(
  level: AIInvariantConfidence,
  evidenceMax: number
): AIAttackConfidence {
  const base = INVARIANT_TO_ATTACK[level];
  if (base === "unsupported") return "unsupported";
  if (evidenceMax >= 0.88 && (base === "likely" || base === "highly_likely")) return "highly_likely";
  if (evidenceMax >= 0.9 && base === "highly_likely") return "confirmed";
  if (evidenceMax < 0.65 && base === "possible") return "possible";
  return base;
}

export function maxAttackEvidenceConfidence(evidence: { confidence: number }[]): number {
  if (evidence.length === 0) return 0;
  return Math.max(...evidence.map((e) => e.confidence));
}
