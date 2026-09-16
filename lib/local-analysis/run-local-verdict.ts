import { generateProductionVerdict, verdictHeadline } from "@/brain/production-verdict/engine";
import { scanRepository } from "@/features/security-scanner/scanner";
import { createLocalScanId, type LocalAnalysisScope } from "./constants";
import { resolveLocalIdentity } from "./local-identity";
import {
  getGitContext,
  parseGitFileCounts,
  resolveScopeFromArgs,
  resolveScopePaths,
} from "./git-scope";
import {
  collectInputFiles,
  mapFindingToPublic,
  mapFindingsToPublic,
  mapScanFindingToVerdictInput,
} from "./map-findings";
import type {
  LocalFindingPublic,
  LocalGitMetadata,
  LocalProductionVerdictResult,
  LocalSnapshotMetadata,
  RunLocalVerdictInput,
} from "./types";
import { buildLocalStatusSummary } from "./format-local-response";
import { listWorkspaceFiles, normalizeWorkspaceRoot } from "./workspace";
import { buildFindingHistory, type FindingHistoryResult } from "./finding-history";
import { LocalPersistenceError, openLocalPersistenceStore, type LocalPersistenceStore } from "./local-persistence";
import { buildLocalSafeFix, type LocalSafeFixResult } from "./local-safe-fix";

// Inlining every finding in the stdio-bridge response is the same mistake
// the GitHub-connected full_product_audit tool made: fine for a handful of
// findings, but a large local workspace (or one with a lot of noise) can
// balloon the JSON-RPC response past what the calling MCP client will wait
// for. buildLocalStatusSummary's narrative already only surfaces the top 6;
// cap the structured array the same way instead of sending everything.
const MAX_INLINE_LOCAL_FINDINGS = 40;
const LOCAL_SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function capLocalFindingsForResponse(findings: LocalFindingPublic[]): LocalFindingPublic[] {
  if (findings.length <= MAX_INLINE_LOCAL_FINDINGS) return findings;
  return [...findings]
    .sort((a, b) => (LOCAL_SEVERITY_RANK[a.severity] ?? 5) - (LOCAL_SEVERITY_RANK[b.severity] ?? 5))
    .slice(0, MAX_INLINE_LOCAL_FINDINGS);
}

function buildGitMetadata(git: ReturnType<typeof getGitContext>): LocalGitMetadata {
  const counts = parseGitFileCounts(git.status);
  return {
    branch: git.branch,
    commitSha: git.commitSha,
    modifiedFiles: counts.modifiedFiles,
    untrackedFiles: counts.untrackedFiles,
    deletedFiles: counts.deletedFiles,
  };
}

function buildInsufficientDataResult(input: {
  workspace: string;
  scope: LocalAnalysisScope;
  git: ReturnType<typeof getGitContext>;
  snapshot: LocalSnapshotMetadata;
  reason: string;
  identity: Awaited<ReturnType<typeof resolveLocalIdentity>>;
}): LocalProductionVerdictResult {
  const scanId = createLocalScanId();
  const { verdict } = generateProductionVerdict({
    projectId: input.identity.projectId,
    repositoryId: input.identity.repositoryId,
    scanId,
    commitSha: input.git.commitSha,
    branch: input.git.branch,
    scanStatus: "completed",
    securityScore: null,
    filesAnalyzed: 0,
    filesDiscovered: input.snapshot.filesAnalyzed,
    findings: [],
    partialScanFailure: input.snapshot.truncated,
  });

  return {
    source: "local",
    gitAvailable: input.git.isGitRepository,
    scope: input.scope,
    phase: input.snapshot.truncated ? "partial" : "complete",
    workspace: input.workspace,
    branch: input.git.branch,
    commitSha: input.git.commitSha,
    verdictStatus: verdict.status,
    score: verdict.score,
    blockersCount: verdict.blockersCount,
    findings: [],
    findingsOmittedCount: 0,
    productionVerdict: verdict as unknown as Record<string, unknown>,
    snapshot: input.snapshot,
    git: buildGitMetadata(input.git),
    scanMetrics: {
      inputFiles: 0,
      scannedFiles: 0,
      rulesRun: 0,
      truncated: input.snapshot.truncated,
    },
    narrative: buildLocalStatusSummary({
      scope: input.scope,
      verdictStatus: verdict.status,
      score: verdict.score,
      findings: [],
      reason: input.reason,
    }),
    methodologyNote: verdict.methodologyNote,
    identity: { projectId: input.identity.projectId, repositoryId: input.identity.repositoryId, workspaceId: input.identity.workspaceId },
  };
}

export async function runLocalProductionVerdict(
  input: RunLocalVerdictInput = {}
): Promise<LocalProductionVerdictResult> {
  const workspace = normalizeWorkspaceRoot(input.workspacePath ?? process.cwd());
  const scope = resolveScopeFromArgs(input);
  const git = getGitContext(workspace);
  const listing = listWorkspaceFiles(workspace);
  // L1.2: real, workspace-derived identity -- a local UUID (or, once a
  // cloud resolver is wired in a later phase, the server-verified cloud
  // project) instead of the same fixed LOCAL_PROJECT_ID/LOCAL_REPOSITORY_ID
  // for every repository on the machine.
  const identity = await resolveLocalIdentity(workspace);
  const emptySnapshot: LocalSnapshotMetadata = {
    filesAnalyzed: 0,
    filesExcluded: listing.stats.filesExcluded,
    bytesAnalyzed: 0,
    truncated: listing.truncated,
    credentialsSkipped: listing.stats.credentialsSkipped,
  };

  const { scope: resolvedScope, paths, requiresGit } = resolveScopePaths(git, scope);

  if (requiresGit) {
    return buildInsufficientDataResult({
      workspace,
      scope,
      git,
      snapshot: emptySnapshot,
      reason:
        "Git is not available in this workspace. Use scope=workspace or initialize a git repository.",
      identity,
    });
  }

  if (resolvedScope !== "workspace" && paths.size === 0) {
    return buildInsufficientDataResult({
      workspace,
      scope: resolvedScope,
      git,
      snapshot: emptySnapshot,
      reason: "No changed files detected for the selected scope.",
      identity,
    });
  }

  const scopedListing =
    resolvedScope === "workspace"
      ? listing
      : listWorkspaceFiles(workspace, { onlyRelativePaths: paths });

  const inputFiles = collectInputFiles(
    workspace,
    resolvedScope === "workspace" ? undefined : paths
  );

  if (inputFiles.length === 0) {
    return buildInsufficientDataResult({
      workspace,
      scope: resolvedScope,
      git,
      snapshot: {
        filesAnalyzed: 0,
        filesExcluded: scopedListing.stats.filesExcluded,
        bytesAnalyzed: 0,
        truncated: scopedListing.truncated,
        credentialsSkipped: scopedListing.stats.credentialsSkipped,
      },
      reason: "No readable source files found inside the authorized workspace.",
      identity,
    });
  }

  const scan = await scanRepository(inputFiles);
  const scanId = createLocalScanId();
  const bytesAnalyzed = inputFiles.reduce((sum, file) => sum + file.content.length, 0);
  // L1.6: a rule can fail independently of the file-count/byte-limit
  // truncation this flag previously covered alone (most notably
  // osv-sbom-rule.ts on a network/offline failure -- see the L1.5 fix to
  // features/security-analysis/rules/osv-sbom-rule.ts). scanRepository()
  // already tracks this via ScanResult.omissions (reason: "rule-error"),
  // exactly as lib/local-analysis/local-orchestrator.ts's own L1.5 fix
  // reads it -- this is the same signal, read here for the first time by
  // the actually-live MCP scan path (run-local-verdict.ts), which
  // previously reported "complete" even when a rule had failed. Without
  // this, L1.6's own history would have treated such a scan as authoritative
  // for resolving prior findings -- exactly the false negative the PARTIAL/
  // FAILED SCANS rule (ABSENCE OF EVIDENCE IS NOT EVIDENCE OF RESOLUTION)
  // exists to prevent.
  const ruleFailed = scan.omissions.some((o) => o.reason === "rule-error");
  const snapshotTruncated = scopedListing.truncated || scan.metrics.truncated;
  const partialScanFailure = snapshotTruncated || ruleFailed;
  const snapshot: LocalSnapshotMetadata = {
    filesAnalyzed: scan.metrics.scannedFiles,
    filesExcluded: scopedListing.stats.filesExcluded,
    bytesAnalyzed,
    truncated: snapshotTruncated,
    credentialsSkipped: scopedListing.stats.credentialsSkipped,
  };

  const { verdict } = generateProductionVerdict({
    projectId: identity.projectId,
    repositoryId: identity.repositoryId,
    scanId,
    commitSha: git.commitSha,
    branch: git.branch,
    scanStatus: "completed",
    securityScore: scan.score.score,
    filesAnalyzed: scan.metrics.scannedFiles,
    filesDiscovered: scopedListing.stats.discoveredFiles,
    findings: scan.findings.map(mapScanFindingToVerdictInput),
    partialScanFailure,
  });

  const publicFindings = mapFindingsToPublic(scan.findings);
  const actionableFindings = publicFindings.filter((finding) => !finding.safeToIgnore);
  const inlineFindings = capLocalFindingsForResponse(publicFindings);
  const phase: "complete" | "partial" = partialScanFailure ? "partial" : "complete";

  const persistence = input.persist
    ? persistLocalScan({
        workspace,
        scanId,
        identity,
        scope: resolvedScope,
        phase,
        git,
        durationMs: scan.metrics.durationMs,
        findings: scan.findings.map(mapScanFindingToVerdictInput),
        ruleFailed,
        verdict: {
          projectId: identity.projectId,
          repositoryId: identity.repositoryId,
          workspaceId: identity.workspaceId,
          status: verdict.status,
          score: verdict.score,
          blockersCount: verdict.blockersCount,
          criticalBlockersCount: verdict.criticalBlockersCount,
          highBlockersCount: verdict.highBlockersCount,
          verdict: verdict as never,
        },
      })
    : undefined;

  return {
    source: "local",
    gitAvailable: git.isGitRepository,
    scope: resolvedScope,
    phase,
    workspace,
    branch: git.branch,
    commitSha: git.commitSha,
    verdictStatus: verdict.status,
    score: verdict.score,
    blockersCount: verdict.blockersCount,
    findings: inlineFindings,
    findingsOmittedCount: Math.max(0, publicFindings.length - inlineFindings.length),
    productionVerdict: verdict as unknown as Record<string, unknown>,
    snapshot,
    git: buildGitMetadata(git),
    scanMetrics: {
      inputFiles: scan.metrics.inputFiles,
      scannedFiles: scan.metrics.scannedFiles,
      rulesRun: scan.metrics.rulesRun,
      truncated: snapshotTruncated,
    },
    narrative: buildLocalStatusSummary({
      scope: resolvedScope,
      verdictStatus: verdict.status,
      score: verdict.score,
      findings: actionableFindings,
      headline: verdictHeadline(verdict.status),
      executiveSummary: verdict.executiveSummary,
      topPriorities: verdict.topPriorities.map((priority) => priority.title),
    }),
    methodologyNote: verdict.methodologyNote,
    correlation: {
      ready: Boolean(git.commitSha),
      commitSha: git.commitSha,
      branch: git.branch,
      reason: git.commitSha
        ? undefined
        : "Local analysis has no verified commit SHA for GitHub correlation.",
    },
    identity: { projectId: identity.projectId, repositoryId: identity.repositoryId, workspaceId: identity.workspaceId },
    persistence,
  };
}

/**
 * L1.6: opt-in persistence for the live scan path, reusing local-persistence
 * .ts exactly as lib/local-analysis/local-orchestrator.ts's own `persist`
 * option does (same store, same saveScanResult call shape) -- this is NOT a
 * second persistence system, it is the same one gaining a second caller.
 * A write failure is reported on the result, never thrown -- a scan's own
 * findings/verdict must never be withheld because remembering them failed.
 */
function persistLocalScan(input: {
  workspace: string;
  scanId: string;
  identity: { projectId: string; repositoryId: string; workspaceId: string };
  scope: LocalAnalysisScope;
  phase: "complete" | "partial";
  git: ReturnType<typeof getGitContext>;
  durationMs: number;
  findings: ReturnType<typeof mapScanFindingToVerdictInput>[];
  ruleFailed: boolean;
  verdict: {
    projectId: string;
    repositoryId: string;
    workspaceId: string;
    status: string;
    score: number | null;
    blockersCount: number;
    criticalBlockersCount: number;
    highBlockersCount: number;
    verdict: unknown;
  };
}): LocalProductionVerdictResult["persistence"] {
  const counts = parseGitFileCounts(input.git.status);
  const dirty = counts.modifiedFiles + counts.untrackedFiles + counts.deletedFiles > 0;
  let store: LocalPersistenceStore | undefined;
  try {
    store = openLocalPersistenceStore(input.workspace);
    store.saveScanResult({
      scan: {
        scanId: input.scanId,
        projectId: input.identity.projectId,
        repositoryId: input.identity.repositoryId,
        workspaceId: input.identity.workspaceId,
        scope: input.scope,
        phase: input.phase,
        branch: input.git.branch,
        commitSha: input.git.commitSha,
        dirty,
        durationMs: input.durationMs,
        errorMessage: input.ruleFailed ? "One or more security rules failed to complete." : null,
        engines: [{ engine: "native", status: input.ruleFailed ? "PARTIAL" : "COMPLETED", durationMs: input.durationMs, findingsCount: input.findings.length }],
      },
      findings: input.findings,
      verdict: input.verdict as Parameters<LocalPersistenceStore["saveScanResult"]>[0]["verdict"],
    });
    return { status: "saved", scanId: input.scanId };
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof LocalPersistenceError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "Unknown persistence failure.",
    };
  } finally {
    store?.close();
  }
}

/** Caps how many new/resolved findings are inlined in a history summary -- an MCP-facing payload, not a dashboard (see buildLocalFindings for the same discipline over the full findings list). */
const MAX_INLINE_HISTORY_FINDINGS = 10;

export type LocalHistorySummary = {
  latestScan: { scanId: string; createdAt: string; phase: string };
  previousScan: { scanId: string; createdAt: string; phase: string } | null;
  verdict: {
    current: { status: string; score: number | null };
    previous: { status: string; score: number | null } | null;
    changed: boolean;
  };
  currentFindingsCount: number;
  newCount: number;
  persistingCount: number;
  resolvedCount: number;
  lifecycleUnknownCount: number;
  newFindings: Array<{ ruleId: string; title: string; filePath: string | null; severity: string | null }>;
  resolvedFindings: Array<{ ruleId: string; title: string; filePath: string | null; severity: string | null }>;
  note: string;
};

/**
 * L1.6: reads (never runs) persisted scan history for a workspace via
 * finding-history.ts, then shapes it into a small, agent-friendly summary --
 * the same MAX_INLINE_* discipline capLocalFindingsForResponse already
 * applies to the plain findings list. Returns null when there is no
 * persisted scan yet (a fresh workspace, or persist was never requested) --
 * never a fabricated empty-but-present history.
 */
function readLocalHistorySummary(workspace: string, identity: { workspaceId: string; repositoryId: string }): LocalHistorySummary | null {
  let store: LocalPersistenceStore | undefined;
  try {
    store = openLocalPersistenceStore(workspace);
    const history = buildFindingHistory(store, identity);
    if (!history) return null;
    return summarizeHistory(history);
  } catch {
    // Persistence unavailable is never fatal to a status/findings response --
    // it just means no history is available yet, matching this function's
    // own "returns null" contract for "nothing persisted."
    return null;
  } finally {
    store?.close();
  }
}

function summarizeHistory(history: FindingHistoryResult): LocalHistorySummary {
  const toInline = (entries: Array<{ ruleId: string; title: string; filePath: string | null; severity: string | null }>) =>
    entries.slice(0, MAX_INLINE_HISTORY_FINDINGS).map((f) => ({ ruleId: f.ruleId, title: f.title, filePath: f.filePath, severity: f.severity }));

  return {
    latestScan: { scanId: history.currentScan.scanId, createdAt: history.currentScan.createdAt, phase: history.currentScan.phase },
    previousScan: history.previousScan
      ? { scanId: history.previousScan.scanId, createdAt: history.previousScan.createdAt, phase: history.previousScan.phase }
      : null,
    verdict: {
      current: history.verdictHistory.latest
        ? { status: history.verdictHistory.latest.status, score: history.verdictHistory.latest.score }
        : { status: "unknown", score: null },
      previous: history.verdictHistory.previous
        ? { status: history.verdictHistory.previous.status, score: history.verdictHistory.previous.score }
        : null,
      changed: history.verdictHistory.statusChanged,
    },
    currentFindingsCount: history.currentFindings.length,
    newCount: history.delta.counts.newCount,
    persistingCount: history.delta.counts.persistingCount,
    resolvedCount: history.delta.counts.resolvedCount,
    lifecycleUnknownCount: history.delta.counts.lifecycleUnknownCount,
    newFindings: toInline(history.delta.newFindings),
    resolvedFindings: toInline(history.delta.resolvedFindings),
    note: history.delta.currentScanComplete
      ? "\"resolvedFindings\" means not detected in the latest complete scan -- not proven fixed or secure."
      : "The latest scan was partial or incomplete; no findings are reported as resolved because their absence cannot be trusted (absence of evidence is not evidence of resolution).",
  };
}

export async function buildLocalWorkspaceStatus(workspacePath?: string) {
  const workspace = normalizeWorkspaceRoot(workspacePath ?? process.cwd());
  const listing = listWorkspaceFiles(workspace);
  const git = getGitContext(workspace);
  const gitMeta = buildGitMetadata(git);
  const identity = await resolveLocalIdentity(workspace);
  const history = readLocalHistorySummary(workspace, identity);
  return {
    source: "local" as const,
    gitAvailable: git.isGitRepository,
    workspace,
    branch: git.branch,
    commitSha: git.commitSha,
    isGitRepository: git.isGitRepository,
    gitStatus: git.status,
    git: gitMeta,
    snapshot: {
      filesAnalyzed: listing.files.length,
      filesExcluded: listing.stats.filesExcluded,
      bytesAnalyzed: listing.totalBytes,
      truncated: listing.truncated,
      credentialsSkipped: listing.stats.credentialsSkipped,
    },
    filesCount: listing.files.length,
    totalBytes: listing.totalBytes,
    truncated: listing.truncated,
    analysisReadiness: listing.files.length > 0 ? "ready" : "empty",
    ignoredExamples: ["node_modules/", ".git/", ".env (credentials skipped)"],
    history,
  };
}

export function buildLocalReview(input: { workspacePath?: string; gitDiffOnly?: boolean }) {
  const workspace = normalizeWorkspaceRoot(input.workspacePath ?? process.cwd());
  const git = getGitContext(workspace);
  const scope = input.gitDiffOnly ? "diff" : "working_tree";
  const diff = input.gitDiffOnly
    ? git.diff
    : `${git.stagedDiff ?? ""}\n${git.diff ?? ""}`.trim();

  return {
    source: "local" as const,
    gitAvailable: git.isGitRepository,
    scope,
    branch: git.branch,
    git: buildGitMetadata(git),
    hasChanges: Boolean(git.status?.trim()),
    diffPreview: diff ? diff.slice(0, 4000) : null,
    message: git.status?.trim()
      ? "Local changes detected. Use sequrai_local_audit or audit_local_project with scope working_tree, staged, or diff."
      : "No local changes detected.",
  };
}

/**
 * L1.7/L1.8: "explain this finding and give me a fix" for the latest
 * persisted scan of THIS workspace -- identity is always resolved from the
 * caller's own boundary-checked workspace path (never accepted as an
 * override), so this cannot be pointed at another workspace's findings. See
 * local-safe-fix.ts for the actual lookup/prompt-building logic; this
 * wrapper only resolves identity and manages the store's lifetime, matching
 * every other local-tool-handlers.ts entry point's own pattern.
 */
export async function buildLocalFix(workspacePath: string | undefined, correlationKey?: string): Promise<LocalSafeFixResult> {
  const workspace = normalizeWorkspaceRoot(workspacePath ?? process.cwd());
  const identity = await resolveLocalIdentity(workspace);
  const store = openLocalPersistenceStore(workspace);
  try {
    return buildLocalSafeFix(store, { workspaceId: identity.workspaceId, repositoryId: identity.repositoryId }, { correlationKey });
  } finally {
    store.close();
  }
}

export async function buildLocalFindings(workspacePath?: string) {
  const workspace = normalizeWorkspaceRoot(workspacePath ?? process.cwd());
  // L1.6: persist=true so this call (a genuine fresh scan, same as
  // sequrai_local_audit) is remembered and can be diffed against by future
  // calls -- without this, sequrai_local_findings would never produce any
  // history to read back.
  const result = await runLocalProductionVerdict({ workspacePath, scope: "workspace", persist: true });
  const history = readLocalHistorySummary(workspace, result.identity);
  return {
    source: "local" as const,
    scope: "workspace" as const,
    findings: result.findings.filter(
      (finding) =>
        finding.severity === "critical" ||
        finding.severity === "high" ||
        !finding.safeToIgnore
    ),
    history,
  };
}

export async function buildLocalPrepareManifest(workspacePath?: string) {
  const workspace = normalizeWorkspaceRoot(workspacePath ?? process.cwd());
  const listing = listWorkspaceFiles(workspace);
  return {
    source: "local" as const,
    workspace,
    files: listing.files.map((file) => ({
      path: file.relativePath,
      size: file.size,
    })),
    snapshot: {
      filesAnalyzed: listing.files.length,
      filesExcluded: listing.stats.filesExcluded,
      bytesAnalyzed: listing.totalBytes,
      truncated: listing.truncated,
      credentialsSkipped: listing.stats.credentialsSkipped,
    },
    totalBytes: listing.totalBytes,
    truncated: listing.truncated,
    redaction: "credentials_excluded_at_walk_time",
    note: "Manifest only. Remote analysis requires explicit user action.",
  };
}
