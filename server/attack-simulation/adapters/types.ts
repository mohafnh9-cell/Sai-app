import type { SafeRuntimeGuardContext, SafeRuntimeStepKind, SafeRuntimeStepResult } from "../runtime/types";

export type AttackAdapterSimulationOutcome = "vulnerable" | "protected";

export type AttackAdapterStepContext = {
  adapterId: string;
  stepKind: SafeRuntimeStepKind;
  stepLabel: string;
  guard: SafeRuntimeGuardContext;
  fixtures?: Record<string, unknown>;
  attackerProfile?: Record<string, unknown>;
  protectedAssets?: Record<string, unknown>[];
};

export interface AttackAdapterModule {
  readonly id: string;
  executeStep(input: AttackAdapterStepContext): SafeRuntimeStepResult;
}

export type AttackAdapterStepHandler = (
  input: AttackAdapterStepContext,
  outcome: AttackAdapterSimulationOutcome
) => SafeRuntimeStepResult;

export type MvpAttackAdapterConfig = {
  id: string;
  handlers: Partial<Record<SafeRuntimeStepKind, AttackAdapterStepHandler>>;
};
