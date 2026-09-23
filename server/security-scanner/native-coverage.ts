/**
 * Whether the native rule engine actually evaluated everything it planned to.
 *
 * The scanner records a rule that threw (`metrics.ruleFailures`, an
 * omission with reason "rule-error") and rules it never ran because the time
 * budget ran out (omission reason "time-limit"). Both used to be logged and
 * then ignored: the scan still finished "completed" and the verdict treated
 * the missing rules as "found nothing", so a crashed authorization rule looked
 * exactly like a clean authorization review. A rule that did not run is
 * missing evidence, and missing evidence must never read as a clean result.
 *
 * Deliberately NOT counted: omissions that are input policy rather than
 * engine failure (ignored/binary/invalid paths, individually oversized
 * files, the total input cap). Those change what is scannable, not whether
 * the engine that scanned it worked; they are represented by the coverage
 * ratio instead.
 *
 * A scan that recorded no metrics at all (older scans) cannot be judged and is
 * not flagged; a scan whose recorded failure data is present but malformed is
 * flagged, because unreadable evidence is not proof of completeness.
 */
const INCOMPLETE_ENGINE_OMISSION_REASONS = new Set(["rule-error", "time-limit"]);

export function hasIncompleteNativeRuleCoverage(scan: {
  metrics?: unknown;
  omissions?: unknown;
}): boolean {
  const { metrics, omissions } = scan;

  if (metrics && typeof metrics === "object" && !Array.isArray(metrics)) {
    const ruleFailures = (metrics as Record<string, unknown>).ruleFailures;
    if (ruleFailures !== undefined && ruleFailures !== null) {
      if (typeof ruleFailures !== "number" || !Number.isFinite(ruleFailures) || ruleFailures > 0) {
        return true;
      }
    }
  }

  if (omissions !== undefined && omissions !== null) {
    if (!Array.isArray(omissions)) return true;
    for (const omission of omissions) {
      if (!omission || typeof omission !== "object") return true;
      const reason = (omission as Record<string, unknown>).reason;
      if (typeof reason === "string" && INCOMPLETE_ENGINE_OMISSION_REASONS.has(reason)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Snapshot omissions that mean a relevant file could have been analyzed but
 * was not (depth, size, or count limits). Files dropped because they are
 * irrelevant by design (binaries, ignored paths, generated files) are not
 * evidence loss and are excluded.
 */
const DROPPED_RELEVANT_FILE_REASONS = new Set([
  "max_depth",
  "max_file_size",
  "max_total_size",
  "max_file_count",
]);

export function countDroppedRelevantFiles(
  omissions: ReadonlyArray<{ path?: string; reason: string; count?: number }> | null | undefined
): number {
  if (!omissions) return 0;
  let dropped = 0;
  for (const omission of omissions) {
    if (!DROPPED_RELEVANT_FILE_REASONS.has(omission.reason)) continue;
    dropped += omission.path == null ? Math.max(0, omission.count ?? 1) : 1;
  }
  return dropped;
}

/**
 * Only incremental scans may borrow a previous scan's coverage, because they
 * deliberately analyze just the changed files. A full scan never may.
 */
export function isIncrementalScan(scan: { scan_type?: unknown; metrics?: unknown }): boolean {
  if (scan.scan_type === "incremental") return true;
  const metrics = scan.metrics;
  return (
    !!metrics &&
    typeof metrics === "object" &&
    !Array.isArray(metrics) &&
    (metrics as Record<string, unknown>).scanType === "incremental"
  );
}
