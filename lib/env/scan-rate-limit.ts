/**
 * Scan / review rate limits (web manual scans + MCP review_now).
 * Set SCAN_RATE_LIMIT_DISABLED=1 while developing to skip hourly caps.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isScanRateLimitDisabled(): boolean {
  const explicit = process.env.SCAN_RATE_LIMIT_DISABLED?.trim().toLowerCase();
  if (explicit && TRUTHY.has(explicit)) return true;
  if (process.env.NODE_ENV !== "production") return true;
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
