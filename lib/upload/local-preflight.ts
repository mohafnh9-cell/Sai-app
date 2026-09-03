import { SOURCE_ANALYSIS_LIMITS, LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES } from "./source-limits";

export type LocalPreflightFile = { size: number };

export type LocalPreflightLimits = {
  maxFiles: number;
  maxFileBytes: number;
  /** Total-bytes ceiling to warn against -- see LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES for why this is a transport limit, not SOURCE_ANALYSIS_LIMITS.maxTotalBytes. */
  maxTotalBytes: number;
};

export type LocalPreflightResult =
  | { ok: true }
  | { ok: false; reason: "too_many_files" | "total_too_large" | "file_too_large" };

const DEFAULT_PREFLIGHT_LIMITS: LocalPreflightLimits = {
  maxFiles: SOURCE_ANALYSIS_LIMITS.maxFiles,
  maxFileBytes: SOURCE_ANALYSIS_LIMITS.maxFileBytes,
  // Deliberately NOT SOURCE_ANALYSIS_LIMITS.maxTotalBytes (40MB): that
  // budget is only reachable via GitHub's server-to-server streaming fetch.
  // Local Analysis transports raw bytes through this app's own request
  // body, which is really capped much lower (see the route's
  // MAX_LOCAL_REQUEST_BYTES comment) -- warn the user with the number that
  // will actually be enforced, not a larger one that would still fail.
  maxTotalBytes: LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES,
};

/**
 * Client-side preflight only (Phase 11.1) -- an optimization so a user
 * isn't left waiting on an upload the server would reject anyway, NOT a
 * security boundary. The server (normalizeLocalFiles) re-enforces every one
 * of these limits authoritatively regardless of what this function decides;
 * a client that skips or lies about this check gains nothing, since the
 * server never trusts client-reported totals.
 */
export function checkLocalSelectionPreflight(
  files: readonly LocalPreflightFile[],
  limits: LocalPreflightLimits = DEFAULT_PREFLIGHT_LIMITS
): LocalPreflightResult {
  if (files.length > limits.maxFiles) {
    return { ok: false, reason: "too_many_files" };
  }
  if (files.some((f) => f.size > limits.maxFileBytes)) {
    return { ok: false, reason: "file_too_large" };
  }
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > limits.maxTotalBytes) {
    return { ok: false, reason: "total_too_large" };
  }
  return { ok: true };
}
