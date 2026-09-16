import {
  correlationKeyForScanFinding,
  diffScanFindingsByIdentity,
  type ScanFindingIdentitySnapshot,
} from "@/lib/correlation/scan-finding-resolution";
import type { LocalPersistenceStore, PersistedFinding, PersistedScan, PersistedVerdict } from "./local-persistence";

/**
 * L1.6 -- turns the scans/findings/verdicts local-persistence.ts already
 * stores into a deterministic, evidence-based security history. This module
 * is read-only: it runs no security engines, computes no verdict, and never
 * mutates a persisted row. Historical scan data is immutable by construction
 * (local-persistence.ts has no UPDATE statement anywhere).
 *
 * Finding identity reuses lib/correlation/scan-finding-resolution.ts's
 * diffScanFindingsByIdentity() UNCHANGED -- the exact same deterministic,
 * line-independent correlation-key diffing already used for the GitHub/cloud
 * scan-job lifecycle (server/security-scanner/scan-job-runner.ts). This is
 * deliberate reuse, not a second fingerprint/lifecycle algorithm: a native
 * finding's identity is metadata.correlationKey (set by
 * features/security-scanner/scanner.ts finalizeFinding); an external-engine
 * finding (OpenGrep/Trivy/crypto/Scorecard) has no correlationKey in its
 * metadata (lib/local-analysis/local-orchestrator.ts's
 * mapExternalFindingToVerdictInput doesn't set one), so
 * buildFindingCorrelationKeyFromParts recomputes one from rule_id + file_path
 * + title -- still deterministic and line-independent, at the cost of a
 * documented limitation: OpenGrep/crypto findings, whose OWN engine-level
 * fingerprint embeds line/column (server/security-engines/opengrep/
 * normalize.ts, server/security-engines/crypto/engine.ts), can appear to
 * resolve-and-reappear (RESOLVED then NEW) if the same violation's title
 * text changes or its line moves far enough to change nothing else
 * observable at this layer. Trivy and Scorecard findings are unaffected --
 * their own fingerprints never included a line number.
 *
 * "Comparable scans" (this module's own decision, matching the Local
 * Identity model from L1.2): two scans are comparable only when they share
 * both workspaceId AND repositoryId. In today's architecture this is close
 * to redundant defense-in-depth -- local-persistence.ts's SQLite database
 * lives at <workspaceRoot>/.sequrai/sequrai.db, so a store instance only
 * ever holds rows for the one workspace it was opened against -- but the
 * filter is still applied explicitly rather than assumed, exactly as the
 * master prompt requires ("Do not treat projectId as authorization... every
 * query must still be scoped correctly").
 */

export type FindingLifecycle = "NEW" | "PERSISTING";

export type FindingHistoryEntry = {
  correlationKey: string;
  ruleId: string;
  title: string;
  severity: string | null;
  category: string | null;
  filePath: string | null;
  lifecycle: FindingLifecycle;
  /** Earliest scan (within the inspected window) this identity was observed in. */
  firstSeenScanId: string;
  firstSeenAt: string;
  /** Most recent scan (within the inspected window) this identity was observed in -- always the current scan for entries returned in `currentFindings`. */
  lastSeenScanId: string;
  lastSeenAt: string;
  severityChanged: boolean;
  previousSeverity: string | null;
};

export type ResolvedFindingSummary = {
  correlationKey: string;
  ruleId: string;
  title: string;
  severity: string | null;
  filePath: string | null;
  lastSeenScanId: string;
  lastSeenAt: string;
};

export type ScanDelta = {
  previousScanId: string | null;
  currentScanId: string;
  /** false when the current scan's phase means "absent" cannot be trusted as "resolved" (see PARTIAL/FAILED SCANS doc below). */
  currentScanComplete: boolean;
  newFindings: FindingHistoryEntry[];
  persistingFindings: FindingHistoryEntry[];
  /**
   * "Not detected in the latest complete scan." NEVER "fixed", "secure", or
   * "verified" -- this store has no verification concept (see the module
   * doc comment's own NOT DETECTED != PROVEN SAFE rule, restated here
   * because this is the field callers are most likely to mislabel in UI).
   */
  resolvedFindings: ResolvedFindingSummary[];
  /**
   * Findings present in the previous comparable scan but absent from the
   * current one, where the current scan was partial/incomplete/cancelled --
   * absence of evidence is not evidence of resolution, so these are reported
   * separately and are NEVER folded into resolvedFindings.
   */
  lifecycleUnknownFindings: ResolvedFindingSummary[];
  /** Count of correlation-key collisions within a single scan (diffScanFindingsByIdentity's own "ambiguous" case) -- never silently resolved either way. */
  ambiguousCount: number;
  counts: {
    newCount: number;
    persistingCount: number;
    resolvedCount: number;
    lifecycleUnknownCount: number;
  };
};

export type VerdictHistorySnapshot = {
  scanId: string;
  status: string;
  score: number | null;
  createdAt: string;
};

export type VerdictHistory = {
  latest: VerdictHistorySnapshot | null;
  previous: VerdictHistorySnapshot | null;
  statusChanged: boolean;
};

export type FindingHistoryResult = {
  workspaceId: string;
  repositoryId: string;
  /** Number of comparable scans inspected to build this result (bounded by the scan window). */
  scanCount: number;
  currentScan: PersistedScan;
  previousScan: PersistedScan | null;
  /** Findings present in the current scan, each tagged with its lifecycle relative to the previous comparable scan. */
  currentFindings: FindingHistoryEntry[];
  delta: ScanDelta;
  verdictHistory: VerdictHistory;
};

/**
 * How many of the most recent comparable scans to load when computing
 * firstSeen/lastSeen. A finding whose true first occurrence predates this
 * window reports firstSeen as the oldest scan inside the window it was
 * found in -- a documented, honest limitation, not silently wrong data.
 * Matches local-persistence.ts listScans()'s own default cap.
 */
const DEFAULT_SCAN_WINDOW = 20;

function findingToSnapshot(finding: PersistedFinding, workspaceId: string): ScanFindingIdentitySnapshot {
  return {
    // finding.id is always set on a row read back from local-persistence.ts
    // (rowToFinding() always assigns `${scan_id}:${row_id}`) -- the fallback
    // only guards the wider VerdictFinding type, which declares id optional.
    id: finding.id ?? `${finding.scanId}:unknown`,
    projectId: workspaceId,
    ruleId: finding.rule_id ?? "",
    filePath: finding.file_path ?? "",
    title: finding.title,
    severity: finding.severity ?? undefined,
    metadata: finding.metadata ?? null,
  };
}

/**
 * Loads scans comparable to each other for lifecycle purposes: same
 * workspaceId and repositoryId, ordered oldest-first by (created_at, scanId)
 * -- deterministic even when two scans share a created_at timestamp
 * (STEP: "do not rely on SQLite incidental row order").
 */
export function loadComparableScans(
  store: LocalPersistenceStore,
  workspaceId: string,
  repositoryId: string,
  limit: number = DEFAULT_SCAN_WINDOW
): PersistedScan[] {
  return store
    .listScans(workspaceId, limit)
    .filter((scan) => scan.repositoryId === repositoryId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.scanId.localeCompare(b.scanId));
}

/**
 * Deterministic two-scan comparison. `previous` is null for a repository's
 * very first comparable scan -- every current finding is then NEW and there
 * is nothing to resolve (test matrix #1).
 */
export function computeScanDelta(input: {
  workspaceId: string;
  previous: { scan: PersistedScan; findings: PersistedFinding[] } | null;
  current: { scan: PersistedScan; findings: PersistedFinding[] };
}): ScanDelta {
  const currentComplete = input.current.scan.phase === "complete";
  const previousById = new Map((input.previous?.findings ?? []).map((f) => [f.id, f] as const));
  const currentById = new Map(input.current.findings.map((f) => [f.id, f] as const));

  const previousSnapshots = (input.previous?.findings ?? []).map((f) => findingToSnapshot(f, input.workspaceId));
  const currentSnapshots = input.current.findings.map((f) => findingToSnapshot(f, input.workspaceId));

  const diff = diffScanFindingsByIdentity({
    projectId: input.workspaceId,
    previous: previousSnapshots,
    current: currentSnapshots,
  });

  function buildEntry(
    lifecycle: FindingLifecycle,
    currentSnapshot: ScanFindingIdentitySnapshot,
    previousSnapshot: ScanFindingIdentitySnapshot | undefined
  ): FindingHistoryEntry {
    const finding = currentById.get(currentSnapshot.id)!;
    const prevFinding = previousSnapshot ? previousById.get(previousSnapshot.id) : undefined;
    const severity = finding.severity ?? null;
    const previousSeverity = prevFinding?.severity ?? null;
    return {
      correlationKey: correlationKeyForScanFinding(currentSnapshot),
      ruleId: finding.rule_id ?? "",
      title: finding.title,
      severity,
      category: finding.category ?? null,
      filePath: finding.file_path ?? null,
      lifecycle,
      firstSeenScanId: input.current.scan.scanId,
      firstSeenAt: input.current.scan.createdAt,
      lastSeenScanId: input.current.scan.scanId,
      lastSeenAt: input.current.scan.createdAt,
      severityChanged: Boolean(prevFinding) && previousSeverity !== severity,
      previousSeverity,
    };
  }

  const persistingFindings = diff.unchanged.map((entry) => buildEntry("PERSISTING", entry.current!, entry.previous));
  const newFindings = diff.new.map((entry) => buildEntry("NEW", entry.current!, undefined));

  function buildResolvedSummary(previousSnapshot: ScanFindingIdentitySnapshot): ResolvedFindingSummary {
    const finding = previousById.get(previousSnapshot.id)!;
    return {
      correlationKey: correlationKeyForScanFinding(previousSnapshot),
      ruleId: finding.rule_id ?? "",
      title: finding.title,
      severity: finding.severity ?? null,
      filePath: finding.file_path ?? null,
      lastSeenScanId: input.previous!.scan.scanId,
      lastSeenAt: input.previous!.scan.createdAt,
    };
  }

  const resolvedCandidates = diff.resolved.map((entry) => buildResolvedSummary(entry.previous!));
  // ABSENCE OF EVIDENCE IS NOT EVIDENCE OF RESOLUTION: only a `complete`
  // current scan can honestly mark a prior finding resolved (test matrix
  // #6/#7/#8/#9).
  const resolvedFindings = currentComplete ? resolvedCandidates : [];
  const lifecycleUnknownFindings = currentComplete ? [] : resolvedCandidates;

  return {
    previousScanId: input.previous?.scan.scanId ?? null,
    currentScanId: input.current.scan.scanId,
    currentScanComplete: currentComplete,
    newFindings,
    persistingFindings,
    resolvedFindings,
    lifecycleUnknownFindings,
    ambiguousCount: diff.ambiguous.length,
    counts: {
      newCount: newFindings.length,
      persistingCount: persistingFindings.length,
      resolvedCount: resolvedFindings.length,
      lifecycleUnknownCount: lifecycleUnknownFindings.length,
    },
  };
}

function verdictSnapshot(verdict: PersistedVerdict | null): VerdictHistorySnapshot | null {
  return verdict ? { scanId: verdict.scanId, status: verdict.status, score: verdict.score, createdAt: verdict.createdAt } : null;
}

function buildVerdictHistory(store: LocalPersistenceStore, current: PersistedScan, previous: PersistedScan | null): VerdictHistory {
  const latest = verdictSnapshot(store.getVerdictForScan(current.scanId));
  const previousVerdict = previous ? verdictSnapshot(store.getVerdictForScan(previous.scanId)) : null;
  return {
    latest,
    previous: previousVerdict,
    statusChanged: Boolean(latest && previousVerdict && latest.status !== previousVerdict.status),
  };
}

/**
 * Builds the full history result for a repository/workspace: the latest
 * comparable scan's findings tagged with lifecycle, the delta vs. the
 * immediately previous comparable scan, and verdict history. Returns null
 * when there is no persisted scan yet for this workspace/repository (never
 * fabricates an empty-but-present history).
 */
export function buildFindingHistory(
  store: LocalPersistenceStore,
  identity: { workspaceId: string; repositoryId: string },
  options: { scanWindow?: number } = {}
): FindingHistoryResult | null {
  const scans = loadComparableScans(store, identity.workspaceId, identity.repositoryId, options.scanWindow ?? DEFAULT_SCAN_WINDOW);
  if (scans.length === 0) return null;

  const findingsByScan = new Map<string, PersistedFinding[]>();
  for (const scan of scans) {
    findingsByScan.set(scan.scanId, store.getFindingsForScan(scan.scanId));
  }

  const firstSeen = new Map<string, { scanId: string; createdAt: string }>();
  const lastSeen = new Map<string, { scanId: string; createdAt: string }>();
  for (const scan of scans) {
    for (const finding of findingsByScan.get(scan.scanId) ?? []) {
      const key = correlationKeyForScanFinding(findingToSnapshot(finding, identity.workspaceId));
      if (!firstSeen.has(key)) firstSeen.set(key, { scanId: scan.scanId, createdAt: scan.createdAt });
      lastSeen.set(key, { scanId: scan.scanId, createdAt: scan.createdAt });
    }
  }

  const currentScan = scans[scans.length - 1]!;
  const previousScan = scans.length > 1 ? scans[scans.length - 2]! : null;

  const delta = computeScanDelta({
    workspaceId: identity.workspaceId,
    previous: previousScan ? { scan: previousScan, findings: findingsByScan.get(previousScan.scanId) ?? [] } : null,
    current: { scan: currentScan, findings: findingsByScan.get(currentScan.scanId) ?? [] },
  });

  const withWindowHistory = (entry: FindingHistoryEntry): FindingHistoryEntry => {
    const seen = firstSeen.get(entry.correlationKey);
    const last = lastSeen.get(entry.correlationKey);
    return {
      ...entry,
      firstSeenScanId: seen?.scanId ?? entry.firstSeenScanId,
      firstSeenAt: seen?.createdAt ?? entry.firstSeenAt,
      lastSeenScanId: last?.scanId ?? entry.lastSeenScanId,
      lastSeenAt: last?.createdAt ?? entry.lastSeenAt,
    };
  };

  const newFindings = delta.newFindings.map(withWindowHistory);
  const persistingFindings = delta.persistingFindings.map(withWindowHistory);
  const currentFindings = [...newFindings, ...persistingFindings].sort((a, b) =>
    a.correlationKey.localeCompare(b.correlationKey)
  );

  return {
    workspaceId: identity.workspaceId,
    repositoryId: identity.repositoryId,
    scanCount: scans.length,
    currentScan,
    previousScan,
    currentFindings,
    delta: { ...delta, newFindings, persistingFindings },
    verdictHistory: buildVerdictHistory(store, currentScan, previousScan),
  };
}
