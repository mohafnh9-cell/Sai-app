import type { CoreUniqueId } from "../contracts/identifiers";
import type { CoreEvidence } from "../evidence/evidence.types";
import type { CoreAttackExecutionClassification } from "../attacks/attack.types";

export type CoreRuntimeClassification = CoreAttackExecutionClassification;

export type CoreRuntimeExecutionStatus =
  | "completed"
  | "failed"
  | "skipped"
  | "blocked"
  | "timeout"
  | "budget_exceeded"
  | "partial";

export type CoreExecutionPlan = {
  id: CoreUniqueId;
  label: string;
  stepIds: CoreUniqueId[];
  metadata?: Record<string, unknown>;
};

export type CoreExecutionStep = {
  id: CoreUniqueId;
  order: number;
  kind: string;
  label: string;
  status: CoreRuntimeExecutionStatus;
};

export type CoreExecutionResult = {
  id: CoreUniqueId;
  planId: CoreUniqueId;
  status: CoreRuntimeExecutionStatus;
  classification: CoreRuntimeClassification;
  evidence: CoreEvidence<string>[];
  durationMs: number;
};

export type CoreRuntimeSummary = {
  plansTotal: number;
  plansCompleted: number;
  plansFailed: number;
  plansSkipped: number;
  executionDurationMs: number;
  results: CoreExecutionResult[];
};

export type CoreRuntimeContext = {
  runId: CoreUniqueId;
  organizationId: string;
  projectId: string;
  metadata?: Record<string, unknown>;
};

export type CoreRuntimeValidatorContract = {
  validatePlan(plan: CoreExecutionPlan): { valid: boolean; issues: string[] };
  validateResult(result: CoreExecutionResult): { valid: boolean; issues: string[] };
};

export interface CoreRuntimeContract {
  execute(context: CoreRuntimeContext, plans: CoreExecutionPlan[]): Promise<CoreRuntimeSummary>;
}
