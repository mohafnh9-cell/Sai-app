/**
 * Scan / review rate limits (web manual scans + MCP review_now).
 *
 * Production default: limits ON (5 web scans / repo / hour, 10 MCP reviews / org / hour).
 * Opt out temporarily with SCAN_RATE_LIMIT_DISABLED=1.
 *
 * Development default: unlimited unless SCAN_RATE_LIMIT_ENABLED=1.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isExplicitlyTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized != null && TRUTHY.has(normalized);
}

export function isScanRateLimitEnabled(): boolean {
  return isExplicitlyTruthy(process.env.SCAN_RATE_LIMIT_ENABLED);
}

function isProductionRuntime(): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  return process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview";
}

export function isScanRateLimitDisabled(): boolean {
  if (isExplicitlyTruthy(process.env.SCAN_RATE_LIMIT_DISABLED)) return true;
  if (!isProductionRuntime()) {
    return !isScanRateLimitEnabled();
  }
  return false;
}

/** null = unlimited */
export function webScansPerRepositoryPerHourLimit(): number | null {
  if (isScanRateLimitDisabled()) return null;
  const raw = process.env.WEB_SCANS_PER_REPOSITORY_PER_HOUR?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 5;
}

/** null = unlimited */
export function mcpReviewsPerOrganizationPerHourLimit(): number | null {
  if (isScanRateLimitDisabled()) return null;
  const raw = process.env.MCP_REVIEWS_PER_ORGANIZATION_PER_HOUR?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 10;
}
