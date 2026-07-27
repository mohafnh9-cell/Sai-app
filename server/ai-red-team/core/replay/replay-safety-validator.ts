import type { CoreReplayPlan } from "./replay.types";

export type ReplayValidationStatus =
  | "Valid"
  | "Valid with warnings"
  | "Blocked"
  | "Unsupported"
  | "Invalid";

export type ReplaySafetyValidation = {
  status: ReplayValidationStatus;
  issues: string[];
  warnings: string[];
};

/** Replay plans must never auto-execute; validate structure and safety metadata. */
export function validateReplayPlanSafety(plan: CoreReplayPlan): ReplaySafetyValidation {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (plan.metadata.executable) {
    issues.push("Replay metadata.executable must be false (no auto-execution).");
  }
  if (!plan.sequence?.steps?.length) {
    issues.push("Replay sequence requires at least one step.");
  }
  if (!plan.findingId) {
    issues.push("Replay plan must reference findingId.");
  }
  if (!plan.metadata.expectedOutcome?.trim()) {
    warnings.push("expectedOutcome should describe deterministic expected evidence.");
  }
  if (!plan.expectedEvidence?.length) {
    warnings.push("expectedEvidence should declare required evidence artifacts.");
  }

  for (const step of plan.sequence.steps) {
    if (!step.label?.trim()) {
      issues.push(`Replay step ${step.id} missing label.`);
    }
  }

  if (issues.length) {
    return { status: "Invalid", issues, warnings };
  }
  if (warnings.length) {
    return { status: "Valid with warnings", issues, warnings };
  }
  return { status: "Valid", issues, warnings };
}
