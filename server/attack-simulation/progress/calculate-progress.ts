import type { AttackExecutionStep } from "../contracts/attack-execution-step";
import { ATTACK_EXECUTION_STEP_STATUSES } from "../contracts/enums";

const COMPLETED_STEP_STATUSES = new Set<string>([
  "completed",
  "skipped",
]);

export type ProgressSnapshot = {
  progressPercent: number;
  estimatedRemainingMs: number | null;
  completedWeight: number;
  totalWeight: number;
};

export function calculateProgressFromSteps(
  steps: ReadonlyArray<Pick<AttackExecutionStep, "weight" | "status" | "durationMs">>,
  options?: {
    historicalMsPerWeight?: number;
    observedMsPerWeight?: number;
  }
): ProgressSnapshot {
  const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0);
  if (totalWeight <= 0) {
    return {
      progressPercent: 0,
      estimatedRemainingMs: null,
      completedWeight: 0,
      totalWeight: 0,
    };
  }

  const completedWeight = steps.reduce((sum, step) => {
    if (!COMPLETED_STEP_STATUSES.has(step.status)) return sum;
    return sum + step.weight;
  }, 0);

  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((completedWeight / totalWeight) * 100))
  );

  const remainingWeight = totalWeight - completedWeight;
  if (remainingWeight <= 0) {
    return { progressPercent: 100, estimatedRemainingMs: 0, completedWeight, totalWeight };
  }

  const completedDurations = steps
    .filter((step) => COMPLETED_STEP_STATUSES.has(step.status) && step.durationMs != null)
    .map((step) => ({ weight: step.weight, durationMs: step.durationMs as number }));

  let msPerWeight = options?.observedMsPerWeight ?? options?.historicalMsPerWeight;
  if (msPerWeight == null && completedDurations.length > 0) {
    const totalCompletedWeight = completedDurations.reduce((sum, row) => sum + row.weight, 0);
    const totalCompletedMs = completedDurations.reduce((sum, row) => sum + row.durationMs, 0);
    if (totalCompletedWeight > 0) {
      msPerWeight = totalCompletedMs / totalCompletedWeight;
    }
  }

  const estimatedRemainingMs =
    msPerWeight == null ? null : Math.max(0, Math.round(remainingWeight * msPerWeight));

  return { progressPercent, estimatedRemainingMs, completedWeight, totalWeight };
}

/** Campaign progress aggregates all execution steps under the campaign. */
export function calculateCampaignProgressFromSteps(
  steps: ReadonlyArray<Pick<AttackExecutionStep, "weight" | "status" | "durationMs">>,
  options?: {
    historicalMsPerWeight?: number;
  }
): ProgressSnapshot {
  return calculateProgressFromSteps(steps, options);
}

export function calculateElapsedMs(startedAt: string | null, nowMs = Date.now()): number {
  if (!startedAt) return 0;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, nowMs - started);
}

export function assertStepWeightsValid(
  steps: ReadonlyArray<Pick<AttackExecutionStep, "weight">>
): void {
  const total = steps.reduce((sum, step) => sum + step.weight, 0);
  if (total <= 0) {
    throw new Error("Attack execution plan requires at least one step with positive weight");
  }
}
