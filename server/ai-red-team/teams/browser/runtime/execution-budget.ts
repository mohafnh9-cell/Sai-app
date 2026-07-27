import type { BrowserTeamBudget } from "../browser-team.config";

export class ExecutionBudget {
  private startedAt = Date.now();
  private navigations = 0;
  private actions = 0;
  private requests = 0;
  private routes = 0;
  private screenshots = 0;

  constructor(private readonly limits: BrowserTeamBudget) {}

  get exhausted(): boolean {
    return (
      Date.now() - this.startedAt >= this.limits.maxDurationMs ||
      this.navigations >= this.limits.maxNavigations ||
      this.actions >= this.limits.maxActions ||
      this.requests >= this.limits.maxRequests ||
      this.routes >= this.limits.maxRoutes
    );
  }

  get partialReason(): string | null {
    if (Date.now() - this.startedAt >= this.limits.maxDurationMs) return "duration_budget_exhausted";
    if (this.routes >= this.limits.maxRoutes) return "route_budget_exhausted";
    if (this.navigations >= this.limits.maxNavigations) return "navigation_budget_exhausted";
    if (this.actions >= this.limits.maxActions) return "action_budget_exhausted";
    if (this.requests >= this.limits.maxRequests) return "request_budget_exhausted";
    return null;
  }

  recordNavigation() {
    this.navigations += 1;
  }

  recordAction() {
    this.actions += 1;
  }

  recordRequest() {
    this.requests += 1;
  }

  recordRoute() {
    this.routes += 1;
  }

  recordScreenshot() {
    this.screenshots += 1;
  }

  snapshot() {
    return {
      navigations: this.navigations,
      actions: this.actions,
      requests: this.requests,
      routes: this.routes,
      screenshots: this.screenshots,
      elapsedMs: Date.now() - this.startedAt,
    };
  }
}
