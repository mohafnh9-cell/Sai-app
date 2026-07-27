import type { BusinessInvariant } from "../invariants/invariant.types";
import type { BusinessAbuseCase } from "../abuse/abuse.types";
import type { BusinessLogicExecutionResult } from "../runtime/runtime.types";
import type {
  BusinessLogicFindingConfidence,
  BusinessLogicFindingSeverity,
} from "./finding.types";

const CONFIDENCE_MAP: Record<
  BusinessLogicExecutionResult["classification"],
  BusinessLogicFindingConfidence
> = {
  confirmed: "confirmed",
  highly_likely: "highly_likely",
  likely: "likely",
  inconclusive: "possible",
  unsupported: "unsupported",
  blocked: "unsupported",
  rejected: "unsupported",
};

export function findingConfidenceFromExecution(
  execution: BusinessLogicExecutionResult
): BusinessLogicFindingConfidence {
  const mapped = CONFIDENCE_MAP[execution.classification] ?? "possible";
  if (execution.violatedInvariantId === null) {
    if (mapped === "confirmed" || mapped === "highly_likely" || mapped === "likely") {
      return mapped;
    }
    return execution.classification === "likely" ? "possible" : "unsupported";
  }
  return mapped;
}

export function findingSeverity(input: {
  invariant: BusinessInvariant;
  abuseCase: BusinessAbuseCase | null;
  execution: BusinessLogicExecutionResult;
  confidence: BusinessLogicFindingConfidence;
}): BusinessLogicFindingSeverity {
  if (input.confidence === "unsupported" || input.confidence === "possible") {
    return "informational";
  }

  let base: BusinessLogicFindingSeverity = "medium";

  if (input.invariant.protectedValueKind === "monetary") base = "high";
  if (input.abuseCase?.severity === "critical") base = "critical";
  else if (input.abuseCase?.severity === "high") base = "high";
  else if (input.abuseCase?.severity === "low") base = "low";

  if (input.execution.violatedInvariantId && input.confidence === "confirmed") {
    if (base === "high") return "critical";
    if (base === "medium") return "high";
  }

  if (
    input.abuseCase &&
    ["double_spend", "credit_duplication", "quota_bypass", "workflow_bypass"].includes(
      input.abuseCase.category
    )
  ) {
    return input.confidence === "confirmed" ? "critical" : "high";
  }

  return base;
}
