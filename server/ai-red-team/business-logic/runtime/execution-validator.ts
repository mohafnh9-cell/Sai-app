import type { BusinessAbuseCase } from "../abuse/abuse.types";
import type { BusinessInvariant } from "../invariants/invariant.types";
import type {
  BusinessLogicExecutionClassification,
  BusinessLogicExecutionEvidence,
  BusinessLogicExecutionResult,
  BusinessLogicExecutionStatus,
} from "./runtime.types";

const CONFIDENCE_ORDER: BusinessLogicExecutionClassification[] = [
  "confirmed",
  "highly_likely",
  "likely",
  "inconclusive",
  "unsupported",
  "blocked",
  "rejected",
];

function rank(classification: BusinessLogicExecutionClassification): number {
  return CONFIDENCE_ORDER.indexOf(classification);
}

function minClassification(
  a: BusinessLogicExecutionClassification,
  b: BusinessLogicExecutionClassification
): BusinessLogicExecutionClassification {
  return rank(a) <= rank(b) ? a : b;
}

function invariantLevelToCap(
  level: BusinessInvariant["confidence"]
): BusinessLogicExecutionClassification {
  switch (level) {
    case "explicit":
      return "confirmed";
    case "confirmed":
      return "highly_likely";
    case "strongly_inferred":
    case "inferred":
      return "likely";
    case "assumed":
      return "inconclusive";
    default:
      return "unsupported";
  }
}

export function classifyExecution(input: {
  status: BusinessLogicExecutionStatus;
  invariant: BusinessInvariant | null;
  abuseCase: BusinessAbuseCase | null;
  evidence: BusinessLogicExecutionEvidence[];
  invariantViolated: boolean;
  mockExecuted: boolean;
}): BusinessLogicExecutionClassification {
  if (input.status === "blocked") return "blocked";
  if (input.status === "failed" || input.status === "timeout") return "rejected";
  if (input.status === "budget_exceeded") return "inconclusive";
  if (!input.invariant) return "unsupported";

  const evidenceMax =
    input.evidence.length === 0 ? 0 : Math.max(...input.evidence.map((e) => e.confidence));

  if (evidenceMax < 0.5) return "unsupported";

  let classification: BusinessLogicExecutionClassification = "inconclusive";
  const cap = invariantLevelToCap(input.invariant.confidence);

  if (input.mockExecuted && input.invariantViolated) {
    if (evidenceMax >= 0.92 && input.invariant.confidence === "explicit") {
      classification = "confirmed";
    } else if (evidenceMax >= 0.85) {
      classification = "highly_likely";
    } else if (evidenceMax >= 0.7) {
      classification = "likely";
    } else {
      classification = "inconclusive";
    }
  } else if (!input.mockExecuted && input.status === "completed") {
    classification = evidenceMax >= 0.75 ? "likely" : "inconclusive";
  }

  if (input.abuseCase?.confidence === "unsupported") {
    classification = minClassification(classification, "unsupported");
  }

  return minClassification(classification, cap);
}

export function validateExecutionResult(
  result: BusinessLogicExecutionResult,
  invariant: BusinessInvariant | null,
  abuseCase: BusinessAbuseCase | null
): BusinessLogicExecutionResult {
  const classification = classifyExecution({
    status: result.status,
    invariant,
    abuseCase,
    evidence: result.evidence,
    invariantViolated: result.violatedInvariantId !== null,
    mockExecuted: result.executionMode === "mock_runtime" || result.executionMode === "simulation_only",
  });

  return {
    ...result,
    classification,
    confidence: classification,
  };
}

export const BusinessLogicExecutionValidator = {
  classify: classifyExecution,
  validateResult: validateExecutionResult,
};
