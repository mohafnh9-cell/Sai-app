/**
 * Scan / review rate limits (web manual scans + MCP review_now).
 *
 * Private beta default: unlimited (no hourly cap). Enable caps before public launch:
 *   SCAN_RATE_LIMIT_ENABLED=1
 *
 * Or force unlimited explicitly:
 *   SCAN_RATE_LIMIT_DISABLED=1
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isExplicitlyTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized != null && TRUTHY.has(normalized);
}

export function isScanRateLimitEnabled(): boolean {
  return isExplicitlyTruthy(process.env.SCAN_RATE_LIMIT_ENABLED);
}

export function isScanRateLimitDisabled(): boolean {
  if (isExplicitlyTruthy(process.env.SCAN_RATE_LIMIT_DISABLED)) return true;
  if (process.env.NODE_ENV !== "production") return true;
  if (!isScanRateLimitEnabled()) return true;
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
