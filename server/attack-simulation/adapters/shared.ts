import type {
  AttackAdapterSimulationOutcome,
  AttackAdapterStepContext,
  AttackAdapterStepHandler,
  MvpAttackAdapterConfig,
  AttackAdapterModule,
} from "./types";
import type { SafeRuntimeStepKind, SafeRuntimeStepResult } from "../runtime/types";

export function resolveAttackAdapterSimulationOutcome(
  fixtures?: Record<string, unknown>
): AttackAdapterSimulationOutcome {
  const raw = fixtures?.simulationOutcome ?? fixtures?.outcome;
  if (raw === "protected") return "protected";
  return "vulnerable";
}

export function adapterClassification(
  mode: AttackAdapterStepContext["guard"]["mode"]
): SafeRuntimeStepResult["classification"] {
  if (mode === "static") return "static_analysis";
  if (mode === "sandbox") return "sandbox";
  if (mode === "authorized_staging") return "authorized_staging";
  return "simulated";
}

export function completedAdapterStep(
  input: AttackAdapterStepContext,
  observedBehavior: string,
  extra?: Partial<SafeRuntimeStepResult>
): SafeRuntimeStepResult {
  return {
    outcome: "completed",
    classification: adapterClassification(input.guard.mode),
    expectedBehavior: `Safe completion of ${input.stepLabel}`,
    observedBehavior,
    statusCode: extra?.statusCode ?? null,
    sideEffects: extra?.sideEffects ?? {},
    auditTrail: [`adapter:${input.adapterId}`, `step:${input.stepKind}`, ...(extra?.auditTrail ?? [])],
    durationMs: extra?.durationMs ?? 1,
    ...extra,
  };
}

export function genericAdapterStep(
  input: AttackAdapterStepContext,
  outcome: AttackAdapterSimulationOutcome
): SafeRuntimeStepResult {
  return completedAdapterStep(
    input,
    `${input.stepLabel} completed for ${input.adapterId} (${outcome})`,
    { auditTrail: [`outcome:${outcome}`] }
  );
}

export function requestStep(
  input: AttackAdapterStepContext,
  outcome: AttackAdapterSimulationOutcome,
  vulnerable: { observed: string; statusCode: number; sideEffects?: Record<string, unknown> },
  protectedRun: { observed: string; statusCode: number; sideEffects?: Record<string, unknown> }
): SafeRuntimeStepResult {
  const payload = outcome === "protected" ? protectedRun : vulnerable;
  return completedAdapterStep(input, payload.observed, {
    statusCode: payload.statusCode,
    sideEffects: payload.sideEffects ?? {},
    auditTrail: [`outcome:${outcome}`, "phase:execute_request"],
  });
}

export function createMvpAttackAdapter(config: MvpAttackAdapterConfig): AttackAdapterModule {
  return {
    id: config.id,
    executeStep(input) {
      const outcome = resolveAttackAdapterSimulationOutcome(input.fixtures);
      const handler: AttackAdapterStepHandler =
        config.handlers[input.stepKind] ??
        ((ctx, resolvedOutcome) => genericAdapterStep(ctx, resolvedOutcome));
      return handler(input, outcome);
    },
  };
}

export function observeFromExecute(
  input: AttackAdapterStepContext,
  outcome: AttackAdapterSimulationOutcome,
  exploitHint: string,
  protectionHint: string
): SafeRuntimeStepResult {
  return completedAdapterStep(
    input,
    outcome === "protected" ? protectionHint : exploitHint,
    { auditTrail: [`outcome:${outcome}`, "phase:observe_response"] }
  );
}

export function verifyFromExecute(
  input: AttackAdapterStepContext,
  outcome: AttackAdapterSimulationOutcome,
  exploitHint: string,
  protectionHint: string
): SafeRuntimeStepResult {
  return completedAdapterStep(
    input,
    outcome === "protected" ? protectionHint : exploitHint,
    { auditTrail: [`outcome:${outcome}`, "phase:verify_side_effects"] }
  );
}

export function allStepKinds(): SafeRuntimeStepKind[] {
  return [
    "validate_preconditions",
    "create_fixtures",
    "authenticate_attacker",
    "execute_request",
    "observe_response",
    "verify_side_effects",
    "collect_evidence",
    "cleanup",
  ];
}
