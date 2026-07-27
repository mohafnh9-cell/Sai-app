export type ApiTeamBudget = {
  maxDurationMs: number;
  maxRequests: number;
  maxEndpoints: number;
  maxResponseBytes: number;
};

export const DEFAULT_API_TEAM_BUDGET: ApiTeamBudget = {
  maxDurationMs: 120_000,
  maxRequests: 150,
  maxEndpoints: 60,
  maxResponseBytes: 256_000,
};
