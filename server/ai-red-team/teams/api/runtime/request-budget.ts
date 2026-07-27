import type { ApiTeamBudget } from "../api-team.config";

export class ApiRequestBudget {
  private startedAt = Date.now();
  private requests = 0;

  constructor(
    private readonly limits: ApiTeamBudget,
    private readonly maxFromAuth?: number
  ) {}

  get exhausted(): boolean {
    const maxReq = Math.min(this.limits.maxRequests, this.maxFromAuth ?? this.limits.maxRequests);
    return Date.now() - this.startedAt >= this.limits.maxDurationMs || this.requests >= maxReq;
  }

  recordRequest(): void {
    this.requests += 1;
  }

  snapshot() {
    return { requests: this.requests, elapsedMs: Date.now() - this.startedAt };
  }
}
