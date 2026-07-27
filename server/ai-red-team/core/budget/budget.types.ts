export type CoreExecutionBudget = {
  maxPlans: number;
  maxRuntimeMs: number;
  maxConcurrentExecutions: number;
};

export type CoreRuntimeBudget = {
  maxPlans: number;
  maxRuntimeMs: number;
  maxSimulations: number;
};

export type CorePromptBudget = {
  maxPrompts: number;
  maxTokens: number | null;
};

export type CoreTimeBudget = {
  maxDurationMs: number;
  perStepTimeoutMs: number;
};

export type CoreSpecialistBudget = {
  maxSpecialists: number;
  maxBudgetMs: number;
};

export type CoreTokenBudget = {
  maxTokens: number;
};

export type CoreBudgetUsage = {
  runtimeMsUsed: number;
  plansExecuted: number;
  promptsUsed: number;
  simulationsUsed: number;
};

export type CoreBudgetEnforcementResult = {
  withinBudget: boolean;
  reason: string | null;
  usage: CoreBudgetUsage;
};
