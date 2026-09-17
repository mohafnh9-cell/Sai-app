import { generateProductionVerdict, verdictHeadline } from "@/brain/production-verdict/engine";
import { getGitContext, parseGitFileCounts, resolveScopeFromArgs } from "./git-scope";
import { mapVerdictFindingsToPublic } from "./map-findings";
import type {
  LocalFindingPublic,
  LocalGitMetadata,
  LocalProductionVerdictResult,
  RunLocalVerdictInput,
} from "./types";
import { buildLocalStatusSummary } from "./format-local-response";
import { listWorkspaceFiles, normalizeWorkspaceRoot } from "./workspace";
import { buildFindingHistory, type FindingHistoryResult } from "./finding-history";
import { openLocalPersistenceStore, type LocalPersistenceStore } from "./local-persistence";
import { buildLocalSafeFix, type LocalSafeFixResult } from "./local-safe-fix";
import { resolveLocalIdentity } from "./local-identity";
import { runLocalSecurityOrchestrator, type LocalOrchestratorResult } from "./local-orchestrator";

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

function buildGitMetadata(git: LocalOrchestratorResult["git"]): LocalGitMetadata {
  const counts = parseGitFileCounts(git.status);
  return {
    branch: git.branch,
    commitSha: git.commitSha,
    modifiedFiles: counts.modifiedFiles,
    untrackedFiles: counts.untrackedFiles,
    deletedFiles: counts.deletedFiles,
  };
}

/**
 * F9: run-local-verdict.ts's MCP-facing entry point now DELEGATES to the
 * existing local orchestrator instead of calling scanRepository() directly.
 * Previously this function was the only real caller of scanRepository() in
 * the live MCP path, while lib/local-analysis/local-orchestrator.ts's
 * runLocalSecurityOrchestrator() -- the multi-engine coordinator built in
 * L1.1, wired for cancellation in L1.4, and covered by its own test suite
 * ever since -- had no production caller at all (confirmed repeatedly in
 * the L1.6 and Runtime<->Cloud Integration audits). That meant every real
 * sequrai_local_audit/findings call only ever ran the native engine;
 * OpenGrep/Trivy/crypto/Scorecard existed but never executed for a real
 * developer. This function is now a thin adapter: run the orchestrator
 * once, then reshape its generic LocalOrchestratorResult into the existing
 * LocalProductionVerdictResult MCP contract -- no scan/verdict/persistence
 * logic is reimplemented here.
 */
export async function runLocalProductionVerdict(
  input: RunLocalVerdictInput = {}
): Promise<LocalProductionVerdictResult> {
  const workspace = normalizeWorkspaceRoot(input.workspacePath ?? process.cwd());
  const scope = resolveScopeFromArgs(input);

  const result = await runLocalSecurityOrchestrator({
    workspacePath: workspace,
    scope,
    gitDiffOnly: input.gitDiffOnly,
    persist: input.persist,
  });

  return buildLocalProductionVerdictResult(result);
}

function buildLocalProductionVerdictResult(result: LocalOrchestratorResult): LocalProductionVerdictResult {
  const publicFindings = mapVerdictFindingsToPublic(result.findings);
  const actionableFindings = publicFindings.filter((finding) => !finding.safeToIgnore);
  const inlineFindings = capLocalFindingsForResponse(publicFindings);

  // The orchestrator only computes a verdict when phase allowed one
  // (STEP 3/10/19 in local-orchestrator.ts: never fabricate a verdict for
  // an incomplete or cancelled run). This MCP response's verdict fields
  // are required, though -- every prior version of this function always
  // returned one, including for its own "insufficient data" cases. Rather
  // than widen the public contract to make verdictStatus/score optional
  // (a bigger, less backward-compatible change), the same shared verdict
  // engine is called a second time here with what's actually known (0
  // findings, partialScanFailure: true) -- the exact same fallback pattern
  // this function's own previous buildInsufficientDataResult already used,
  // not a second verdict algorithm.
  const engineErrorMessage = result.engines.flatMap((e) => e.errors).find(Boolean)?.message;
  const verdict =
    result.verdict ??
    generateProductionVerdict({
      projectId: result.identity.projectId,
      repositoryId: result.identity.repositoryId,
      scanId: result.scanId,
      commitSha: result.git.commitSha,
      branch: result.git.branch,
      scanStatus: "completed",
      securityScore: null,
      filesAnalyzed: 0,
      filesDiscovered: result.snapshot.discoveredFiles,
      findings: [],
      partialScanFailure: true,
    }).verdict;

  return {
    source: "local",
    gitAvailable: result.git.isGitRepository,
    scope: result.scope,
    phase: result.phase,
    workspace: result.workspace,
    branch: result.git.branch,
    commitSha: result.git.commitSha,
    verdictStatus: verdict.status,
    score: verdict.score,
    blockersCount: verdict.blockersCount,
    findings: inlineFindings,
    findingsOmittedCount: Math.max(0, publicFindings.length - inlineFindings.length),
    productionVerdict: verdict as unknown as Record<string, unknown>,
    snapshot: {
      filesAnalyzed: result.snapshot.scannedFiles,
      filesExcluded: result.snapshot.filesExcluded,
      bytesAnalyzed: result.snapshot.bytesAnalyzed,
      truncated: result.snapshot.truncated,
      credentialsSkipped: result.snapshot.credentialsSkipped,
    },
    git: buildGitMetadata(result.git),
    scanMetrics: {
      inputFiles: result.snapshot.inputFiles,
      scannedFiles: result.snapshot.scannedFiles,
      rulesRun: result.snapshot.rulesRun,
      truncated: result.snapshot.truncated,
    },
    narrative: buildLocalStatusSummary({
      scope: result.scope,
      verdictStatus: verdict.status,
      score: verdict.score,
      findings: actionableFindings,
      headline: verdictHeadline(verdict.status),
      executiveSummary: verdict.executiveSummary,
      topPriorities: verdict.topPriorities.map((priority) => priority.title),
      reason: result.phase === "incomplete" || result.phase === "cancelled" ? engineErrorMessage : undefined,
      credentialsSkipped: result.snapshot.credentialsSkipped,
    }),
    methodologyNote: verdict.methodologyNote,
    engines: result.engines,
    correlation: {
      ready: Boolean(result.git.commitSha),
      commitSha: result.git.commitSha,
      branch: result.git.branch,
      reason: result.git.commitSha
        ? undefined
        : "Local analysis has no verified commit SHA for GitHub correlation.",
    },
    identity: result.identity,
    persistence: result.persistence,
  };
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
