import type { EngineExecutionStatus, EngineId } from "@/server/security-engines/types";
import { runSecurityEngines } from "@/server/security-engines/orchestrate";
import { scanRepository } from "@/features/security-scanner/scanner";
import type { VerdictEngineInput } from "@/brain/production-verdict/engine";
import { collectInputFiles, mapScanFindingToVerdictInput } from "./map-findings";
import { getGitContext, resolveScopeFromArgs, resolveScopePaths } from "./git-scope";
import { normalizeWorkspaceRoot } from "./workspace";
import { createLocalScanId, type LocalAnalysisScope } from "./constants";
import { resolveLocalIdentity } from "./local-identity";

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

export type LocalOrchestratorPhase = "complete" | "partial" | "incomplete";

export type LocalOrchestratorResult = {
  source: "local";
  scanId: string;
  workspace: string;
  scope: LocalAnalysisScope;
  /**
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
};

export type LocalOrchestratorInput = {
  workspacePath: string;
  scope?: LocalAnalysisScope;
  gitDiffOnly?: boolean;
  /**
   * Best-effort only: checked between phases, not mid-engine-execution --
   * neither scanRepository() nor the SecurityEngine.execute() contract
   * accepts a signal today, so an already-running external engine's own
   * self-enforced timeout is what actually bounds it (STEP 4/9's "do not
   * invent a second timeout mechanism").
   */
  signal?: AbortSignal;
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

  // STEP 6: a scope this workspace genuinely cannot honor (staged/diff/
  // working_tree without git available) must be represented honestly, not
  // silently downgraded to a workspace-wide scan or faked as "no findings".
  if (requiresGit) {
    return {
      source: "local",
      scanId,
      workspace,
      scope: resolvedScope,
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

  const files = collectInputFiles(workspace, resolvedScope === "workspace" ? undefined : paths);

  if (input.signal?.aborted) {
    return {
      source: "local",
      scanId,
      workspace,
      scope: resolvedScope,
      phase: "incomplete",
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
    }),
  ]);

  const engineOutcomes: LocalEngineOutcome[] = [];
  let findings: VerdictFinding[] = [];
  let nativeFailed = false;

  if (nativeOutcome.status === "fulfilled") {
    const nativeFindings = nativeOutcome.value.findings.map(mapScanFindingToVerdictInput);
    findings = findings.concat(nativeFindings);
    engineOutcomes.push({
      engine: NATIVE_ENGINE_ID,
      status: "COMPLETED",
      durationMs: Date.now() - nativeStartedAt,
      findingsCount: nativeFindings.length,
      errors: [],
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

  const phase: LocalOrchestratorPhase = nativeFailed ? "incomplete" : externalPartialFailure ? "partial" : "complete";

  return {
    source: "local",
    scanId,
    workspace,
    scope: resolvedScope,
    phase,
    findings: sortFindings(findings),
    engines: engineOutcomes,
    durationMs: Date.now() - startedAt,
  };
}
