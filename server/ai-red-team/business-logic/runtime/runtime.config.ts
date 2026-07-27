import type {
  BusinessLogicRuntimeBudget,
  BusinessLogicRuntimeLimits,
  BusinessLogicRuntimeProfile,
} from "./runtime.types";

export const DEFAULT_BUSINESS_LOGIC_RUNTIME_PROFILE: BusinessLogicRuntimeProfile = {
  id: "mock_deterministic_v1",
  label: "Deterministic mock runtime (no production)",
  allowStagingCandidate: false,
  defaultMode: "mock_runtime",
};

export const DEFAULT_BUSINESS_LOGIC_RUNTIME_BUDGET: BusinessLogicRuntimeBudget = {
  maxPlans: 48,
  maxEvaluations: 120,
  maxRuntimeMs: 30_000,
  maxTransitions: 240,
  maxConcurrentExecutions: 1,
};

export const DEFAULT_BUSINESS_LOGIC_RUNTIME_LIMITS: BusinessLogicRuntimeLimits = {
  perPlanTimeoutMs: 2_000,
  perPlanMaxEvaluations: 8,
  perPlanMaxTransitions: 12,
};

/** Production mutation is never permitted in RT9 Slice 6. */
export const BUSINESS_LOGIC_RUNTIME_PRODUCTION_FORBIDDEN = true as const;
