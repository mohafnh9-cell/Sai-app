import type { AttackExecutionStepStatus } from "../contracts/enums";
import {
  executeSafeRuntimeStep,
  markSafeRuntimeCancelled,
  markSafeRuntimeEmergencyStop,
  type SafeRuntimeSession,
} from "../runtime/safe-runtime";
import type { SafeRuntimeStepKind, SafeRuntimeStepResult } from "../runtime/types";
import {
  isSafeRuntimeStepKind,
  mapRunOutcomeToExecutionStatus,
  mapStepOutcomeToStepStatus,
} from "./step-stage-map";
import type {
  AttackExecutionRunContext,
  AttackExecutionRunOutcome,
  AttackExecutionRunSignal,
  AttackExecutionStepRunResult,
} from "./types";

const TERMINAL_STEP_STATUSES: AttackExecutionStepStatus[] = [
  "completed",
  "failed",
  "skipped",
  "cancelled",
];

function applySignal(session: SafeRuntimeSession, signal?: AttackExecutionRunSignal): SafeRuntimeSession {
  if (signal?.emergencyStop) return markSafeRuntimeEmergencyStop(session);
  if (signal?.cancelled) return markSafeRuntimeCancelled(session);
  return session;
}

function buildStepResult(
  stepId: string,
  stepKind: string,
  runtimeResult: SafeRuntimeStepResult,
  startedAtMs: number,
  completedAtMs: number
): AttackExecutionStepRunResult {
  return {
    stepId,
    stepKind,
    stepStatus: mapStepOutcomeToStepStatus(runtimeResult.outcome),
    runtimeResult,
    startedAtMs,
    completedAtMs,
  };
}

export async function runAttackExecutionSteps(input: {
  context: AttackExecutionRunContext;
  session: SafeRuntimeSession;
  signal?: AttackExecutionRunSignal;
  fixtures?: Record<string, unknown>;
  onBeforeStep?: (step: AttackExecutionRunContext["steps"][number]) => Promise<void> | void;
  onAfterStep?: (
    step: AttackExecutionRunContext["steps"][number],
    result: AttackExecutionStepRunResult
  ) => Promise<void> | void;
}): Promise<AttackExecutionRunOutcome> {
  let session = applySignal(input.session, input.signal);
  const stepResults: AttackExecutionStepRunResult[] = [];
  let blocked = false;
  let failed = false;
  let cancelled = Boolean(input.signal?.cancelled || input.signal?.emergencyStop);
  let skippedSteps = 0;

  const sortedSteps = [...input.context.steps].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const step of sortedSteps) {
    if (cancelled) {
      skippedSteps += 1;
      continue;
    }

    if (TERMINAL_STEP_STATUSES.includes(step.status)) {
      skippedSteps += 1;
      continue;
    }

    await input.onBeforeStep?.(step);

    if (!isSafeRuntimeStepKind(step.kind)) {
      const startedAtMs = Date.now();
      const runtimeResult: SafeRuntimeStepResult = {
        outcome: "failed",
        classification: "blocked",
        observedBehavior: `Unsupported step kind: ${step.kind}`,
        auditTrail: ["unsupported_step_kind"],
        durationMs: 0,
        failureCode: "UNSUPPORTED_STEP_KIND",
        safeFailureMessage: `Step kind ${step.kind} is not supported`,
      };
      stepResults.push(buildStepResult(step.id, step.kind, runtimeResult, startedAtMs, Date.now()));
      await input.onAfterStep?.(step, stepResults[stepResults.length - 1]!);
      failed = true;
      break;
    }

    const startedAtMs = Date.now();
    const { session: nextSession, result } = await executeSafeRuntimeStep(session, {
      stepKind: step.kind as SafeRuntimeStepKind,
      stepLabel: step.label,
      fixtures: input.fixtures,
      attackerProfile: input.context.execution.attackerProfile,
      adapterId: input.context.scenario.adapterId,
      protectedAssets: input.context.execution.protectedAssets,
    });
    session = nextSession;
    const row = buildStepResult(step.id, step.kind, result, startedAtMs, Date.now());
    stepResults.push(row);
    await input.onAfterStep?.(step, row);

    if (result.outcome === "blocked") {
      blocked = true;
      break;
    }
    if (result.outcome === "cancelled") {
      cancelled = true;
      break;
    }
    if (result.outcome === "failed" || result.outcome === "timeout" || result.outcome === "budget_exceeded") {
      failed = true;
      break;
    }
  }

  const executedCount = stepResults.length;
  const allStepsCompleted =
    !blocked &&
    !failed &&
    !cancelled &&
    executedCount + skippedSteps === sortedSteps.length &&
    stepResults.every((row) => row.runtimeResult.outcome === "completed");

  const terminalStatus = mapRunOutcomeToExecutionStatus({
    blocked,
    failed,
    cancelled,
    allStepsCompleted,
  });

  if (terminalStatus === "completed") {
    return { ok: true, terminalStatus, stepResults, skippedSteps, session };
  }

  const last = stepResults[stepResults.length - 1];
  return {
    ok: false,
    terminalStatus,
    failureCode: last?.runtimeResult.failureCode ?? terminalStatus.toUpperCase(),
    safeFailureMessage:
      last?.runtimeResult.safeFailureMessage ??
      (cancelled ? "Attack execution was cancelled" : "Attack execution did not complete"),
    stepResults,
    session,
  };
}
