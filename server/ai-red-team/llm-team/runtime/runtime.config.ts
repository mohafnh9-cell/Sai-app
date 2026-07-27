import type { AIRuntimeBudget, AIRuntimeLimits, AIRuntimeProfile } from "./runtime.types";

export const DEFAULT_AI_RUNTIME_PROFILE: AIRuntimeProfile = {
  id: "safe_synthetic_v1",
  label: "Safe deterministic synthetic runtime (no production)",
  allowStagingCandidate: false,
  defaultMode: "mock_llm",
};

export const DEFAULT_AI_RUNTIME_BUDGET: AIRuntimeBudget = {
  maxPlans: 64,
  maxPrompts: 200,
  maxToolInvocations: 80,
  maxRuntimeMs: 45_000,
  maxSimulations: 120,
};

export const DEFAULT_AI_RUNTIME_LIMITS: AIRuntimeLimits = {
  perPlanTimeoutMs: 2_500,
  perPlanMaxPrompts: 12,
  perPlanMaxToolInvocations: 6,
};

/** Production mutation must never occur in RT10 Slice 6. */
export const AI_RUNTIME_PRODUCTION_FORBIDDEN = true as const;

export const AI_RUNTIME_FORBIDDEN_TOOL_PATTERNS = [
  "delete",
  "drop",
  "payment",
  "charge",
  "transfer",
  "email",
  "send_mail",
  "payout",
  "withdraw",
  "destroy",
  "truncate",
  "exec",
  "shell",
] as const;
