import { buildFindingCorrelationKeyFromParts } from "./finding-identity";

/**
 * Cross-scan finding identity, derived from already-persisted, stable columns
 * (rule_id, file_path, title, metadata.correlationKey) -- never from scan_id,
 * scan_job id, timestamps, or any other per-run/transient field.
 *
 * `metadata.correlationKey` is already computed and persisted for every
 * scan_findings row by the scanner (features/security-scanner/scanner.ts
 * finalizeFinding) and by the incremental-scan carry-forward path
 * (server/security-scanner/scan-job-runner.ts mergeIncrementalFindings).
 * This module only adds the previous-scan-vs-current-scan comparison that
 * was missing -- it does not introduce a new identity scheme.
 */
export type ScanFindingIdentitySnapshot = {
  id: string;
  projectId: string;
  ruleId: string;
  filePath: string;
  title: string;
  severity?: string;
  status?: string;
  metadata?: Record<string, unknown> | null;
};

export function correlationKeyForScanFinding(finding: ScanFindingIdentitySnapshot): string {
  return buildFindingCorrelationKeyFromParts({
    ruleId: finding.ruleId,
    filePath: finding.filePath,
    title: finding.title,
    metadata: finding.metadata ?? null,
  });
}

export type FindingResolutionStatus = "unchanged" | "resolved" | "new" | "ambiguous";

export type FindingResolutionEntry = {
  correlationKey: string;
  status: FindingResolutionStatus;
  previous?: ScanFindingIdentitySnapshot;
  current?: ScanFindingIdentitySnapshot;
  /** Present only for status "ambiguous": more than one finding in a single scan shares this identity. */
  reason?: string;
};

export type FindingResolutionDiff = {
  projectId: string;
  unchanged: FindingResolutionEntry[];
  resolved: FindingResolutionEntry[];
  new: FindingResolutionEntry[];
  ambiguous: FindingResolutionEntry[];
};

/**
 * Groups findings by correlation key within one scan's result set. A key
 * mapping to more than one finding means correlation identity could not
 * uniquely resolve within that scan (e.g. two same-rule, same-file, same
 * generic-title findings without rule-specific fingerprint material) -- we
 * never guess in that case, matching the existing local<->GitHub correlation
 * module's "ambiguous" precedent (lib/correlation/match-findings.ts).
 */
function groupByCorrelationKey(
  findings: ScanFindingIdentitySnapshot[]
): Map<string, ScanFindingIdentitySnapshot[]> {
  const map = new Map<string, ScanFindingIdentitySnapshot[]>();
  for (const finding of findings) {
    const key = correlationKeyForScanFinding(finding);
    const group = map.get(key);
    if (group) group.push(finding);
    else map.set(key, [finding]);
  }
  return map;
}

/**
 * Classifies a project's current-scan findings against its previous-scan
 * findings into unchanged / resolved / new (plus ambiguous, for identity
 * collisions within a single scan). O(n) via Map lookups -- no nested loops.
 *
 * Both `previous` and `current` MUST already be scoped to a single project
 * (e.g. `.eq("project_id", projectId)` at the query site). As a defense-in-
 * depth guard against accidental cross-project comparison, this function
 * throws if any input finding's projectId does not match `projectId`.
 */
export function diffScanFindingsByIdentity(input: {
  projectId: string;
  previous: ScanFindingIdentitySnapshot[];
  current: ScanFindingIdentitySnapshot[];
}): FindingResolutionDiff {
  const { projectId } = input;

  for (const finding of [...input.previous, ...input.current]) {
    if (finding.projectId !== projectId) {
      throw new Error(
        `diffScanFindingsByIdentity: finding ${finding.id} belongs to project ${finding.projectId}, ` +
          `not the requested project ${projectId}. Refusing to compare findings across projects.`
      );
    }
  }

  const previousGroups = groupByCorrelationKey(input.previous);
  const currentGroups = groupByCorrelationKey(input.current);

  const unchanged: FindingResolutionEntry[] = [];
  const resolved: FindingResolutionEntry[] = [];
  const newEntries: FindingResolutionEntry[] = [];
  const ambiguous: FindingResolutionEntry[] = [];

  const allKeys = new Set<string>([...previousGroups.keys(), ...currentGroups.keys()]);

  for (const key of allKeys) {
    const previousMatches = previousGroups.get(key) ?? [];
    const currentMatches = currentGroups.get(key) ?? [];

    if (previousMatches.length > 1 || currentMatches.length > 1) {
      ambiguous.push({
        correlationKey: key,
        status: "ambiguous",
        previous: previousMatches[0],
        current: currentMatches[0],
        reason:
          "More than one finding in a single scan shares this correlation identity; " +
          "resolution cannot be determined safely.",
      });
      continue;
    }

    const previous = previousMatches[0];
    const current = currentMatches[0];

    if (previous && current) {
      unchanged.push({ correlationKey: key, status: "unchanged", previous, current });
    } else if (previous && !current) {
      resolved.push({ correlationKey: key, status: "resolved", previous });
    } else if (current && !previous) {
      newEntries.push({ correlationKey: key, status: "new", current });
    }
  }

  return { projectId, unchanged, resolved, new: newEntries, ambiguous };
}
