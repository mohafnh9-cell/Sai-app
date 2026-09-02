/**
 * M2 (audit): AI (Claude) cost ceiling per organization per day.
 *
 * The existing scan-rate-limit.ts caps how often scans can be STARTED
 * (5/repo/hour, 3 concurrent/org), which already bounds concurrent AI
 * usage indirectly -- AI analysis only ever runs as part of a scan job.
 * What was still missing: a tenant with many repos, or many distinct
 * commits, could stay under those per-repo/per-org-concurrency limits
 * and still generate unbounded Claude spend over a full day. This adds
 * that ceiling.
 *
 * Same pattern as scan-rate-limit.ts: env-configurable, disabled by
 * default outside production unless explicitly enabled, no hardcoded
 * provider pricing -- these are call/token counts, never a dollar figure.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isExplicitlyTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized != null && TRUTHY.has(normalized);
}

function isProductionRuntime(): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  return process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview";
}

export function isAiCostControlDisabled(): boolean {
  if (isExplicitlyTruthy(process.env.AI_COST_CONTROL_DISABLED)) return true;
  if (!isProductionRuntime()) {
    return !isExplicitlyTruthy(process.env.AI_COST_CONTROL_ENABLED);
  }
  return false;
}

/** null = unlimited */
export function aiCallsPerOrganizationPerDayLimit(): number | null {
  if (isAiCostControlDisabled()) return null;
  const raw = process.env.AI_CALLS_PER_ORGANIZATION_PER_DAY?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 200;
}

/** null = unlimited. Token count, never a cost figure -- pricing varies
 * by model/provider and this file must never hardcode it. */
export function aiTokenBudgetPerOrganizationPerDayLimit(): number | null {
  if (isAiCostControlDisabled()) return null;
  const raw = process.env.AI_TOKEN_BUDGET_PER_ORGANIZATION_PER_DAY?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 2_000_000;
}
