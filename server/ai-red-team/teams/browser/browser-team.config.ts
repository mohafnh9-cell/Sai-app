export type BrowserTeamBudget = {
  maxDurationMs: number;
  maxRoutes: number;
  maxDepth: number;
  maxNavigations: number;
  maxActions: number;
  maxRequests: number;
  maxScreenshots: number;
};

export const DEFAULT_BROWSER_TEAM_BUDGET: BrowserTeamBudget = {
  maxDurationMs: 8 * 60 * 1000,
  maxRoutes: 40,
  maxDepth: 4,
  maxNavigations: 80,
  maxActions: 120,
  maxRequests: 200,
  maxScreenshots: 12,
};

export type BrowserTeamConfig = {
  entryPath: string;
  viewport: { width: number; height: number };
  locale: string;
  timezoneId: string;
};

export const DEFAULT_BROWSER_TEAM_CONFIG: BrowserTeamConfig = {
  entryPath: "/",
  viewport: { width: 1280, height: 720 },
  locale: "en-US",
  timezoneId: "UTC",
};
