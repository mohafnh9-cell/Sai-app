import type { CoreUniqueId } from "../contracts/identifiers";

export type CoreSpecialistStatus = "completed" | "partial" | "skipped" | "failed";

export type CoreSpecialistEligibility = {
  eligible: boolean;
  reason: string;
  confidence: number;
};

export type CoreSpecialistPlan = {
  id: CoreUniqueId;
  specialistId: string;
  steps: Array<{ id: string; label: string; order: number }>;
  estimatedDurationMs: number;
};

export type CoreSpecialistObservation = {
  id: CoreUniqueId;
  detail: string;
  confidence: number;
  refId?: CoreUniqueId | null;
};

export type CoreSpecialistResult = {
  specialistId: string;
  status: CoreSpecialistStatus;
  plan: CoreSpecialistPlan | null;
  observations: CoreSpecialistObservation[];
  summary: string;
  durationMs: number;
  failure: { code: string; message: string } | null;
};

export type CoreExecutionSummary = {
  specialistsTotal: number;
  specialistsCompleted: number;
  specialistsSkipped: number;
  specialistsFailed: number;
  observationCount: number;
  budgetConsumedMs: number;
};

export type CoreFailureSummary = {
  failedSpecialists: string[];
  failureCount: number;
  topFailureCode: string | null;
};

export type CoreBudgetConsumption = {
  runtimeMsUsed: number;
  plansExecuted: number;
  simulationsUsed: number;
};

export type CoreSelectionStrategy = "graph_backed" | "priority" | "budget_aware";

export type CoreSpecialistContext = {
  runId: CoreUniqueId;
  organizationId: string;
  projectId: string;
  metadata?: Record<string, unknown>;
};

export interface CoreSpecialist<TContext extends CoreSpecialistContext = CoreSpecialistContext> {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
  canRun(context: TContext): CoreSpecialistEligibility | Promise<CoreSpecialistEligibility>;
  plan(context: TContext): Promise<CoreSpecialistPlan>;
  analyze(context: TContext, plan: CoreSpecialistPlan): Promise<Pick<CoreSpecialistResult, "observations">>;
  summarize(result: CoreSpecialistResult): string;
}

export type CoreSpecialistRegistryContract = {
  register(specialist: CoreSpecialist): void;
  list(): CoreSpecialist[];
};
