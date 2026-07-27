import type { AIAttackCase } from "../attacks/attack.types";
import type { AIInvariant } from "../invariants/invariant.types";
import type { AIExecutionClassification, AIExecutionResult } from "./runtime.types";

export function maxRuntimeEvidenceConfidence(evidence: { confidence: number }[]): number {
  if (evidence.length === 0) return 0;
  return Math.max(...evidence.map((e) => e.confidence));
}

export function classifyExecutionConfidence(input: {
  invariantViolated: boolean;
  evidenceMax: number;
  blocked: boolean;
  simulationRan: boolean;
}): AIExecutionClassification {
  if (input.blocked) return "blocked";
  if (!input.simulationRan) return "unsupported";
  if (input.invariantViolated && input.evidenceMax >= 0.85) return "confirmed";
  if (input.invariantViolated && input.evidenceMax >= 0.78) return "highly_likely";
  if (input.invariantViolated) return "likely";
  if (!input.invariantViolated && input.evidenceMax >= 0.75) return "possible";
  if (!input.invariantViolated) return "inconclusive";
  return "possible";
}

export function validateExecutionResult(
  result: AIExecutionResult,
  invariant: AIInvariant | null,
  attack: AIAttackCase | null
): AIExecutionResult {
  let classification = result.classification;
  if (!invariant) {
    classification = "unsupported";
  } else if (result.status === "blocked") {
    classification = "blocked";
  } else if (result.violatedInvariantId && attack) {
    const evidenceMax = maxRuntimeEvidenceConfidence(result.evidence);
    classification = classifyExecutionConfidence({
      invariantViolated: Boolean(result.violatedInvariantId),
      evidenceMax,
      blocked: false,
      simulationRan: result.simulationsUsed > 0,
    });
  }

  return {
    ...result,
    classification,
    confidence: classification,
  };
}

export const AIExecutionValidator = {
  validate: validateExecutionResult,
  classifyConfidence: classifyExecutionConfidence,
};
