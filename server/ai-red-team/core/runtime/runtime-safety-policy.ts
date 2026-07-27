export type RuntimeSafetyVerdict = "allowed" | "blocked" | "unsupported";

export type RuntimeSafetyEvaluation = {
  verdict: RuntimeSafetyVerdict;
  reasons: string[];
};

/** Domain-agnostic runtime safety gate — teams supply mode labels and flags. */
export function evaluateRuntimeSafety(input: {
  mode: string;
  productionMutationForbidden: boolean;
  allowStagingCandidateExecution: boolean;
  allowProductionLabeledTargets: boolean;
  sideEffectPatterns?: string[];
  targetLabel?: string;
}): RuntimeSafetyEvaluation {
  const reasons: string[] = [];
  if (!input.productionMutationForbidden) {
    return { verdict: "blocked", reasons: ["productionMutationForbidden must remain true."] };
  }
  if (input.mode === "staging_candidate" && !input.allowStagingCandidateExecution) {
    reasons.push("staging_candidate is planning-only.");
  }
  if (input.mode === "production" || input.mode === "live") {
    reasons.push("production/live execution modes are blocked.");
  }
  const label = (input.targetLabel ?? "").toLowerCase();
  if (input.allowProductionLabeledTargets === false && label.includes("production")) {
    reasons.push("production-labeled targets are blocked.");
  }
  for (const pattern of [...(input.sideEffectPatterns ?? [])].sort((a, b) => a.localeCompare(b))) {
    if (label.includes(pattern.toLowerCase())) {
      reasons.push(`Side-effect pattern blocked: ${pattern}.`);
    }
  }
  if (reasons.length) return { verdict: "blocked", reasons };
  if (input.mode === "unsupported") return { verdict: "unsupported", reasons: ["Mode marked unsupported."] };
  return { verdict: "allowed", reasons: [] };
}

export const DEFAULT_SIDE_EFFECT_PATTERNS = ["delete", "charge", "transfer", "payout", "send_email"];
