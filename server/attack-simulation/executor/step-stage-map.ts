import type { AttackExecutionStatus } from "../contracts/enums";
import type { SafeRuntimeStepKind } from "../runtime/types";

const STEP_KIND_TO_STAGE: Record<SafeRuntimeStepKind, AttackExecutionStatus> = {
  validate_preconditions: "validating_preconditions",
  create_fixtures: "creating_fixtures",
  authenticate_attacker: "creating_fixtures",
  execute_request: "executing",
  observe_response: "observing",
  verify_side_effects: "evaluating",
  collect_evidence: "collecting_evidence",
  cleanup: "cleaning_up",
};

export function resolveExecutionStageForStepKind(kind: string): AttackExecutionStatus {
  if (kind in STEP_KIND_TO_STAGE) {
    return STEP_KIND_TO_STAGE[kind as SafeRuntimeStepKind];
  }
  return "executing";
}

export function isSafeRuntimeStepKind(kind: string): kind is SafeRuntimeStepKind {
  return kind in STEP_KIND_TO_STAGE;
}

export function mapStepOutcomeToStepStatus(
  outcome: string
): "completed" | "failed" | "skipped" | "cancelled" {
  if (outcome === "completed") return "completed";
  if (outcome === "skipped") return "skipped";
  if (outcome === "cancelled") return "cancelled";
  return "failed";
}

export function mapRunOutcomeToExecutionStatus(input: {
  blocked: boolean;
  failed: boolean;
  cancelled: boolean;
  allStepsCompleted: boolean;
}): AttackExecutionStatus {
  if (input.cancelled) return "cancelled";
  if (input.blocked) return "blocked";
  if (input.failed) return "failed";
  if (input.allStepsCompleted) return "completed";
  return "failed";
}
