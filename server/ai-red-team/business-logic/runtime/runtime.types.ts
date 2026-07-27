import type { DiscoveredBusinessWorkflowKind } from "../discovery/discovery.types";

export type BusinessLogicExecutionMode =
  | "static_validation"
  | "simulation_only"
  | "mock_runtime"
  | "staging_candidate"
  | "unsupported"
  | "blocked";

export type BusinessLogicExecutionClassification =
  | "confirmed"
  | "highly_likely"
  | "likely"
  | "inconclusive"
  | "unsupported"
  | "blocked"
  | "rejected";

export type BusinessLogicExecutionStatus =
  | "completed"
  | "failed"
  | "skipped"
  | "blocked"
  | "timeout"
  | "budget_exceeded";

export type BusinessLogicMockScenarioKind =
  | "checkout"
  | "subscription"
  | "credits"
  | "quota"
  | "coupon"
  | "invitation"
  | "webhook"
  | "race_condition"
  | "retry"
  | "state_transition";

export type BusinessLogicRuntimeProfile = {
  id: string;
  label: string;
  /** Never allows production mutation — staging_candidate remains planning-only in Slice 6. */
  allowStagingCandidate: boolean;
  defaultMode: BusinessLogicExecutionMode;
};

export type BusinessLogicRuntimeBudget = {
  maxPlans: number;
  maxEvaluations: number;
  maxRuntimeMs: number;
  maxTransitions: number;
  maxConcurrentExecutions: number;
};

export type BusinessLogicRuntimeLimits = {
  perPlanTimeoutMs: number;
  perPlanMaxEvaluations: number;
  perPlanMaxTransitions: number;
};

export type BusinessLogicExecutionEvidence = {
  id: string;
  source: "runtime_mock" | "fsm" | "invariant" | "workflow" | "specialist";
  detail: string;
  confidence: number;
  refId?: string | null;
};

export type BusinessLogicExecutionStep = {
  id: string;
  order: number;
  transitionId: string | null;
  transitionEvent: string | null;
  fromStateId: string | null;
  toStateId: string | null;
  actionKind: string | null;
  economicEffect: string | null;
  note: string | null;
};

export type BusinessLogicExecutionPlan = {
  id: string;
  specialistPlanId: string;
  specialistId: string;
  specialistStepId: string;
  workflowId: string;
  workflowKind: DiscoveredBusinessWorkflowKind | string;
  scenarioKind: BusinessLogicMockScenarioKind;
  requiredEntityIds: string[];
  transitionIds: string[];
  targetInvariantId: string;
  targetAbuseCaseId: string | null;
  assumptions: string[];
  requiredEvidenceRefIds: string[];
  executionMode: BusinessLogicExecutionMode;
  maxEvaluations: number;
  timeoutMs: number;
  rollbackStrategy: "mock_reset" | "none";
};

export type BusinessLogicExecutionResult = {
  executionId: string;
  planId: string;
  workflowId: string;
  specialistId: string;
  executionMode: BusinessLogicExecutionMode;
  status: BusinessLogicExecutionStatus;
  classification: BusinessLogicExecutionClassification;
  confidence: BusinessLogicExecutionClassification;
  evidence: BusinessLogicExecutionEvidence[];
  validatedTransitions: BusinessLogicExecutionStep[];
  validatedAssumptions: string[];
  rejectedAssumptions: string[];
  violatedInvariantId: string | null;
  businessConsequence: string | null;
  failureReason: string | null;
  evaluationsUsed: number;
  transitionsUsed: number;
  durationMs: number;
};

export type BusinessLogicRuntimeBudgetUsage = {
  plansExecuted: number;
  evaluationsUsed: number;
  runtimeMsUsed: number;
  transitionsUsed: number;
};

export type BusinessLogicExecutionSummary = {
  id: string;
  generatedAt: string;
  profileId: string;
  plansTotal: number;
  plansCompleted: number;
  plansFailed: number;
  plansBlocked: number;
  plansSkipped: number;
  partialReason: string | null;
  budgetUsage: BusinessLogicRuntimeBudgetUsage;
  results: BusinessLogicExecutionResult[];
};

export type BusinessLogicExecutionFailureCode =
  | "timeout"
  | "invalid_plan"
  | "unsupported_workflow"
  | "runtime_exception"
  | "missing_context"
  | "budget_exceeded"
  | "unsupported_provider";
