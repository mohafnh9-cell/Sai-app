import type { EngineExecutionStatus, EngineId } from "@/server/security-engines/types";
import { runSecurityEngines } from "@/server/security-engines/orchestrate";
import { scanRepository } from "@/features/security-scanner/scanner";
import { generateProductionVerdict, type VerdictEngineInput } from "@/brain/production-verdict/engine";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { collectInputFiles, mapScanFindingToVerdictInput } from "./map-findings";
import { getGitContext, parseGitFileCounts, resolveScopeFromArgs, resolveScopePaths } from "./git-scope";
import { normalizeWorkspaceRoot } from "./workspace";
import { createLocalScanId, type LocalAnalysisScope } from "./constants";
import { resolveLocalIdentity } from "./local-identity";
import { openLocalPersistenceStore, LocalPersistenceError, type LocalPersistenceStore } from "./local-persistence";

type LocalGitContext = ReturnType<typeof getGitContext>;

export type VerdictFinding = VerdictEngineInput["findings"][number];

/**
 * One engine's outcome, reusing the exact status vocabulary
 * server/security-engines/types.ts already defines (EngineExecutionStatus)
 * so a caller checking status doesn't need a second vocabulary for the
 * native engine vs. the external ones. "native" is not itself a
 * SecurityEngine (registry.ts deliberately excludes it), so its outcome is
 * synthesized here from scanRepository()'s own success/failure -- never
 * silently folded into "0 findings" if it throws (section 21/STEP 3).
 */
export type LocalEngineOutcome = {
  engine: EngineId;
  status: EngineExecutionStatus;
  durationMs: number;
  findingsCount: number;
  errors: Array<{ code: string; message: string }>;
};

/**
 * L1.4: precedence when multiple conditions apply simultaneously is
 * cancelled > incomplete > partial > complete -- a run the caller asked to
 * stop is reported as cancelled even if, say, the native engine had also
 * already failed; cancellation is never downgraded to a lesser-looking
 * status.
 */
export type LocalOrchestratorPhase = "complete" | "partial" | "incomplete" | "cancelled";

/**
 * F9: file-collection/scan-metric stats needed by the MCP-facing response
 * shape (run-local-verdict.ts's LocalProductionVerdictResult) -- sourced
 * from the SAME collectInputFiles()/scanRepository() calls this function
 * already makes for its own purposes, never a second workspace walk or
 * scan. Zeroed out (not fabricated as non-zero) whenever the corresponding
 * step never ran -- e.g. requiresGit/cancelled-before-start/native-failed.
 */
export type LocalOrchestratorSnapshot = {
  inputFiles: number;
  scannedFiles: number;
  discoveredFiles: number;
  filesExcluded: number;
  credentialsSkipped: number;
  bytesAnalyzed: number;
  rulesRun: number;
  truncated: boolean;
  /** The native engine's own deterministic score (features/security-scanner/scoring.ts), null whenever native didn't run. */
  securityScore: number | null;
};

export type LocalOrchestratorResult = {
  source: "local";
  scanId: string;
  workspace: string;
  scope: LocalAnalysisScope;
  /** F9: exposed so callers (run-local-verdict.ts) don't need a second getGitContext() subprocess call to build their own response. */
  git: LocalGitContext;
  snapshot: LocalOrchestratorSnapshot;
  /** F9: exposed so callers don't need a second resolveLocalIdentity() call (which re-reads/re-writes .sequrai/project.json) to build their own response. */
  identity: { projectId: string; repositoryId: string; workspaceId: string };
  /**
   * "cancelled": input.signal fired before the run finished -- never
   * reported as failed, successful, or as zero findings; whatever findings
   * had already been produced by engines that completed before
   * cancellation are still returned, but no verdict is computed (STEP 10:
   * cancellation must not be mistaken for FAILED/SUCCESS/empty-findings).
   * "incomplete": the native engine (the one every other result depends on
   * for scope/normalization) failed outright -- callers must not treat
   * `findings` as meaningful. "partial": native succeeded but one or more
   * external engines FAILED (not SKIPPED -- an engine reporting "not
   * applicable" is a normal, honest outcome, never a failure). "complete":
   * everything that was applicable ran.
   */
  phase: LocalOrchestratorPhase;
  findings: VerdictFinding[];
  engines: LocalEngineOutcome[];
  durationMs: number;
  /**
   * Present only when `phase` allowed a meaningful verdict to be computed
   * (native engine succeeded) -- reuses generateProductionVerdict()
   * unchanged (STEP 8/19: no second verdict engine, no altered
   * thresholds). A HISTORICAL result tied to this scan's commit/dirty
   * state -- never re-interpreted as the current working tree's status
   * (STEP 32).
   */
  verdict?: ProductionVerdictV1;
  /** Present only when `persist: true` was requested. Never silently swallowed -- a write failure is reported here, not hidden behind a successful-looking result (STEP 11). */
  persistence?: { status: "saved"; scanId: string } | { status: "unavailable"; error: string };
};

export type LocalOrchestratorInput = {
  workspacePath: string;
  scope?: LocalAnalysisScope;
  gitDiffOnly?: boolean;
  /**
   * L1.4: genuinely propagated to the external engines (OpenGrep/Trivy kill
   * their running subprocess via safeExec's own abort handling; all four
   * external-and-native-adjacent engines skip immediately if already
   * aborted before they'd have started). The native engine is the one real,
   * honest limitation: scanRepository() has no signal/cancellation contract
   * of its own, so an in-flight native scan is not interrupted -- checked
   * before/after, never mid-execution. Not silently claimed as solved.
   */
  signal?: AbortSignal;
  /** L1.3: when true, persist the scan/findings/verdict to the local SQLite store. Default false -- a scan remains purely in-memory unless explicitly asked to be remembered. */
  persist?: boolean;
  /** Dependency injection for testing (STEP 20) -- when omitted and `persist: true`, a store is opened at the workspace's default .sequrai/sequrai.db and closed again before returning. */
  persistenceStore?: LocalPersistenceStore;
};

const NATIVE_ENGINE_ID: EngineId = "native";

/**
 * SequrAIFinding (server/security-evidence/canonical-finding.ts, what
 * SecurityEngine.execute() returns) -> the same flat VerdictFinding shape
 * server/security-orchestrator/verdict-integration.ts already builds from
 * persisted external_engine_findings rows for the GitHub path (STEP 7:
 * "return normalized external findings in the same model expected by the
 * existing verdict system", without duplicating that DB-backed function,
 * which needs a scanId/organizationId it can query Postgres with -- this
 * local run has neither, so the same field mapping is reproduced directly
 * from the in-memory engine result instead of a database round-trip).
 */
function mapExternalFindingToVerdictInput(
  engine: EngineId,
  finding: { id: string; title: string; severity: string; category: string; affectedFiles: string[]; remediation: string | null; confidence: string; evidence: Array<{ detail?: string | null }>; cwe: string[] }
): VerdictFinding {
  const evidenceText = finding.evidence
    .map((e) => e.detail ?? "")
    .filter(Boolean)
    .join(" | ");
  return {
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    rule_id: `${engine}:${finding.id}`,
    file_path: finding.affectedFiles[0] ?? null,
    start_line: null,
    recommendation: finding.remediation,
    confidence: finding.confidence,
    evidence: evidenceText || null,
    metadata: { engine, cwe: finding.cwe ?? [] },
  };
}

/**
 * A single, deterministic sort key so the merged findings array never
 * depends on Promise settlement order (STEP 15) -- native runs concurrently
 * with the external-engine batch, and within that batch runSecurityEngines
 * already preserves registry order via Promise.all, but this makes the
 * final output order independent of both regardless.
 */
function sortFindings(findings: VerdictFinding[]): VerdictFinding[] {
  return [...findings].sort((a, b) => {
    const ruleA = a.rule_id ?? "";
    const ruleB = b.rule_id ?? "";
    if (ruleA !== ruleB) return ruleA < ruleB ? -1 : 1;
    const pathA = a.file_path ?? "";
    const pathB = b.file_path ?? "";
    if (pathA !== pathB) return pathA < pathB ? -1 : 1;
    return (a.start_line ?? 0) - (b.start_line ?? 0);
  });
}

/**
 * Executes every local-capable SequrAI security engine (native + the
 * external-and-native-adjacent registry: OpenGrep, Trivy, crypto,
 * Scorecard) against a local repository and returns a unified,
 * deterministic, partial-result-safe result -- no source code leaves this
 * machine to produce it (Scorecard's own applicability check will report
 * itself not-applicable without a GitHub-hosted repo, exactly as it already
 * does for any GitHub-connected scan of a repo it can't reach).
 *
 * This is a coordinator only: it reuses runSecurityEngines() (already the
 * one execution path for external engines, previously only ever wired into
 * the GitHub pipeline) and scanRepository() (the native engine, already
 * used by the pre-existing local-analysis path) exactly as they exist --
 * no rule, scoring, correlation, or verdict logic is reimplemented here.
 */
export async function runLocalSecurityOrchestrator(
  input: LocalOrchestratorInput
): Promise<LocalOrchestratorResult> {
  const startedAt = Date.now();
  const workspace = normalizeWorkspaceRoot(input.workspacePath);
  const scanId = createLocalScanId();
  // L1.2: real, workspace-derived identity instead of the same fixed
  // LOCAL_PROJECT_ID/LOCAL_ORGANIZATION_ID for every repository.
  const identity = await resolveLocalIdentity(workspace);

  const git = getGitContext(workspace);
  const scope = resolveScopeFromArgs({ scope: input.scope, gitDiffOnly: input.gitDiffOnly });
  const { scope: resolvedScope, paths, requiresGit } = resolveScopePaths(git, scope);
  const emptySnapshot: LocalOrchestratorSnapshot = {
    inputFiles: 0,
    scannedFiles: 0,
    discoveredFiles: 0,
    filesExcluded: 0,
    credentialsSkipped: 0,
    bytesAnalyzed: 0,
    rulesRun: 0,
    truncated: false,
    securityScore: null,
  };

  // STEP 6: a scope this workspace genuinely cannot honor (staged/diff/
  // working_tree without git available) must be represented honestly, not
  // silently downgraded to a workspace-wide scan or faked as "no findings".
  if (requiresGit) {
    return {
      source: "local",
      scanId,
      workspace,
      scope: resolvedScope,
      git,
      snapshot: emptySnapshot,
      identity: { projectId: identity.projectId, repositoryId: identity.repositoryId, workspaceId: identity.workspaceId },
      phase: "incomplete",
      findings: [],
      engines: [
        {
          engine: NATIVE_ENGINE_ID,
          status: "SKIPPED",
          durationMs: 0,
          findingsCount: 0,
          errors: [{ code: "scope_requires_git", message: `Scope "${resolvedScope}" requires a git repository; none was found at ${workspace}. Use scope "workspace" or initialize git.` }],
        },
      ],
      durationMs: Date.now() - startedAt,
    };
  }

  const { files, listing } = collectInputFiles(workspace, resolvedScope === "workspace" ? undefined : paths);
  const listingSnapshot: LocalOrchestratorSnapshot = {
    ...emptySnapshot,
    inputFiles: files.length,
    discoveredFiles: listing.stats.discoveredFiles,
    filesExcluded: listing.stats.filesExcluded,
    credentialsSkipped: listing.stats.credentialsSkipped,
    bytesAnalyzed: listing.totalBytes,
    truncated: listing.truncated,
  };

  if (input.signal?.aborted) {
    return {
      source: "local",
      scanId,
      workspace,
      scope: resolvedScope,
      git,
      snapshot: listingSnapshot,
      identity: { projectId: identity.projectId, repositoryId: identity.repositoryId, workspaceId: identity.workspaceId },
      phase: "cancelled",
      findings: [],
      engines: [{ engine: NATIVE_ENGINE_ID, status: "SKIPPED", durationMs: 0, findingsCount: 0, errors: [{ code: "aborted", message: "Cancelled before analysis started." }] }],
      durationMs: Date.now() - startedAt,
    };
  }

  const nativeStartedAt = Date.now();
  const [nativeOutcome, externalOutcome] = await Promise.allSettled([
    scanRepository(files),
    runSecurityEngines({
      scanId,
      projectId: identity.projectId,
      // No real organization in local-only mode; the repository's own
      // stable identity is reused here purely as EngineResult bookkeeping
      // metadata (never authorization-checked locally) rather than a
      // single constant shared by every repository on the machine.
      organizationId: identity.mode === "cloud-bound" ? identity.organizationId : identity.repositoryId,
      files,
      githubRepo: null,
      signal: input.signal,
    }),
  ]);

  const engineOutcomes: LocalEngineOutcome[] = [];
  let findings: VerdictFinding[] = [];
  let nativeFailed = false;
  let nativePartialFailure = false;
  let snapshot = listingSnapshot;

  if (nativeOutcome.status === "fulfilled") {
    const nativeFindings = nativeOutcome.value.findings.map(mapScanFindingToVerdictInput);
    findings = findings.concat(nativeFindings);
    snapshot = {
      ...listingSnapshot,
      scannedFiles: nativeOutcome.value.metrics.scannedFiles,
      rulesRun: nativeOutcome.value.metrics.rulesRun,
      truncated: listingSnapshot.truncated || nativeOutcome.value.metrics.truncated,
      securityScore: nativeOutcome.value.score.score,
    };
    // L1.5: a rule inside the native engine can fail independently (most
    // notably osv-sbom-rule.ts on a network/offline failure) while the
    // engine as a whole still succeeds -- scanRepository() already tracks
    // this via ScanResult.omissions (reason: "rule-error"), previously
    // never read by this orchestrator. Surfaced here as PARTIAL with an
    // explicit error per failed rule, reusing the existing shape rather
    // than inventing a new one, so "native ran but one of its checks
    // (e.g. dependency vulnerabilities) didn't" is never silently
    // indistinguishable from "native ran and found nothing there."
    const ruleErrorOmissions = nativeOutcome.value.omissions.filter((o) => o.reason === "rule-error");
    if (ruleErrorOmissions.length > 0) nativePartialFailure = true;
    engineOutcomes.push({
      engine: NATIVE_ENGINE_ID,
      status: ruleErrorOmissions.length > 0 ? "PARTIAL" : "COMPLETED",
      durationMs: Date.now() - nativeStartedAt,
      findingsCount: nativeFindings.length,
      errors: ruleErrorOmissions.map((o) => ({
        code: `native_rule_failed:${o.ruleId ?? "unknown"}`,
        message: o.detail ?? "A native security rule failed to complete.",
      })),
    });
  } else {
    nativeFailed = true;
    const error = nativeOutcome.reason;
    engineOutcomes.push({
      engine: NATIVE_ENGINE_ID,
      status: "FAILED",
      durationMs: Date.now() - nativeStartedAt,
      findingsCount: 0,
      // Never the raw error object (could carry a stack trace with local
      // paths) -- only a plain message, matching the sanitization already
      // used for engine_crashed in server/security-engines/orchestrate.ts.
      errors: [{ code: "native_engine_crashed", message: error instanceof Error ? error.message : "Native engine failed." }],
    });
  }

  let externalPartialFailure = false;
  if (externalOutcome.status === "fulfilled") {
    for (const result of externalOutcome.value.results) {
      engineOutcomes.push({
        engine: result.engine,
        status: result.status,
        durationMs: result.durationMs,
        findingsCount: result.findings.length,
        errors: result.errors,
      });
      if (result.status === "FAILED") externalPartialFailure = true;
      if (result.status === "COMPLETED" || result.status === "PARTIAL") {
        findings = findings.concat(
          result.findings.map((f) =>
            mapExternalFindingToVerdictInput(result.engine, {
              id: f.id,
              title: f.title,
              severity: f.severity,
              category: f.category,
              affectedFiles: f.affectedFiles,
              remediation: f.remediation,
              confidence: f.confidence,
              evidence: f.evidence,
              cwe: f.cwe,
            })
          )
        );
      }
    }
  } else {
    // runSecurityEngines() already isolates every individual engine's
    // failure internally (Promise.all over per-engine try/catch) -- this
    // branch is the batch call itself rejecting, which its own contract
    // doesn't do today, but is handled rather than left to crash the
    // orchestrator if that ever changes.
    externalPartialFailure = true;
    const error = externalOutcome.reason;
    engineOutcomes.push({
      engine: "opengrep",
      status: "FAILED",
      durationMs: 0,
      findingsCount: 0,
      errors: [{ code: "external_engines_batch_crashed", message: error instanceof Error ? error.message : "External engine batch failed." }],
    });
  }

  // Precedence: cancelled > incomplete > partial > complete -- a run the
  // caller asked to stop is reported as cancelled even if native also
  // failed, never downgraded to a lesser-looking status (STEP 34).
  const phase: LocalOrchestratorPhase = input.signal?.aborted
    ? "cancelled"
    : nativeFailed
      ? "incomplete"
      : externalPartialFailure || nativePartialFailure
        ? "partial"
        : "complete";
  const sortedFindings = sortFindings(findings);
  const durationMs = Date.now() - startedAt;

  // Only compute a verdict when the run actually finished on its own terms:
  // an "incomplete" scan (native failed) has nothing a verdict could
  // honestly be built from, and a "cancelled" run must never be presented
  // as a completed, trustworthy analysis regardless of what partial
  // findings exist (STEP 3/10/19: never fabricate one, cancellation is
  // never success).
  let verdict: ProductionVerdictV1 | undefined;
  if (phase !== "incomplete" && phase !== "cancelled") {
    verdict = generateProductionVerdict({
      projectId: identity.projectId,
      repositoryId: identity.repositoryId,
      scanId,
      commitSha: git.commitSha,
      branch: git.branch,
      scanStatus: "completed",
      // F9: previously always null here (this call path had no production
      // caller until F9), unlike run-local-verdict.ts's own old direct
      // scanRepository() call, which always passed the native engine's
      // real score. Filled in from the same snapshot the MCP response now
      // surfaces, not recomputed -- null whenever native didn't run
      // (external findings alone don't produce a scorable security score).
      securityScore: snapshot.securityScore,
      filesAnalyzed: snapshot.scannedFiles,
      filesDiscovered: snapshot.discoveredFiles,
      findings: sortedFindings,
      partialScanFailure: externalPartialFailure || nativePartialFailure,
    }).verdict;
  }

  let persistence: LocalOrchestratorResult["persistence"];
  if (input.persist) {
    const fileCounts = parseGitFileCounts(git.status);
    const dirty = fileCounts.modifiedFiles + fileCounts.untrackedFiles + fileCounts.deletedFiles > 0;
    const ownStore = !input.persistenceStore;
    let store: LocalPersistenceStore | undefined;
    try {
      store = input.persistenceStore ?? openLocalPersistenceStore(workspace);
      store.saveScanResult({
        scan: {
          scanId,
          projectId: identity.projectId,
          repositoryId: identity.repositoryId,
          workspaceId: identity.workspaceId,
          scope: resolvedScope,
          phase,
          branch: git.branch,
          commitSha: git.commitSha,
          dirty,
          durationMs,
          errorMessage: nativeFailed ? engineOutcomes.find((e) => e.engine === NATIVE_ENGINE_ID)?.errors[0]?.message ?? null : null,
          engines: engineOutcomes.map((e) => ({ engine: e.engine, status: e.status, durationMs: e.durationMs, findingsCount: e.findingsCount })),
        },
        findings: sortedFindings,
        verdict: verdict
          ? {
              projectId: identity.projectId,
              repositoryId: identity.repositoryId,
              workspaceId: identity.workspaceId,
              status: verdict.status,
              score: verdict.score,
              blockersCount: verdict.blockersCount,
              criticalBlockersCount: verdict.criticalBlockersCount,
              highBlockersCount: verdict.highBlockersCount,
              verdict,
            }
          : undefined,
      });
      persistence = { status: "saved", scanId };
    } catch (error) {
      // A persistence failure is reported explicitly, never hidden behind
      // an otherwise-successful-looking result (STEP 11) -- the scan's own
      // findings/verdict above are still returned as computed; only the
      // "was this remembered" signal reflects the failure.
      persistence = {
        status: "unavailable",
        error: error instanceof LocalPersistenceError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "Unknown persistence failure.",
      };
    } finally {
      if (ownStore) store?.close();
    }
  }

  return {
    source: "local",
    scanId,
    workspace,
    scope: resolvedScope,
    git,
    snapshot,
    identity: { projectId: identity.projectId, repositoryId: identity.repositoryId, workspaceId: identity.workspaceId },
    phase,
    findings: sortedFindings,
    engines: engineOutcomes,
    durationMs,
    verdict,
    persistence,
  };
}
