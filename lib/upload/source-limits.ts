/**
 * Canonical source-analysis limits, safe to ship to the client (plain
 * numbers, no secrets, no internal config) for preflight validation.
 * lib/github/repository-service.ts's GITHUB_SCAN_LIMITS is the original
 * source of truth for these four fields -- it re-exports this object rather
 * than duplicating the numbers, so there is exactly one place they're
 * defined. This file has no "server-only" import so client components
 * (e.g. LocalAnalysisPicker) can import it directly.
 */
export const SOURCE_ANALYSIS_LIMITS = {
  maxFiles: 8_000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxDepth: 18,
} as const;

/**
 * The real, measured ceiling on bytes Local Analysis can actually transport
 * in one request in this deployment -- see the long comment next to
 * MAX_LOCAL_REQUEST_BYTES in app/api/uploads/analyze/route.ts for why this
 * is smaller than SOURCE_ANALYSIS_LIMITS.maxTotalBytes (GitHub scans reach
 * that larger budget by streaming server-to-server, never through this
 * app's own request body). Exported here so the client preflight check
 * warns the user with the number that will actually be enforced, instead
 * of the larger, unreachable-for-Local-Analysis canonical figure.
 */
export const LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES = 9 * 1024 * 1024;
