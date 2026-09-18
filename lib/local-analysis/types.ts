import type { LocalAnalysisScope } from "./constants";

export type { LocalAnalysisScope };

export type LocalGitContext = {
  isGitRepository: boolean;
  branch: string | null;
  commitSha: string | null;
  status: string | null;
  diff: string | null;
  stagedDiff: string | null;
};

export type LocalFindingPublic = {
  id: string;
  ruleId: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  /**
   * F9: nullable -- an external-engine finding (e.g. Trivy's dependency
   * findings) can legitimately have no source line, and some have no single
   * file path either. Previously always a string/number because only
   * native findings (which always have a location) reached this type;
   * widening rather than fabricating a fake "0"/"" value once external
   * findings started flowing through the same mapper (F9).
   */
  filePath: string | null;
  line: number | null;
  correlationKey: string;
  evidence?: string;
  remediation: string;
  confidence: string;
  safeToIgnore: boolean;
};

export type LocalSnapshotMetadata = {
  filesAnalyzed: number;
  filesExcluded: number;
  bytesAnalyzed: number;
  truncated: boolean;
  credentialsSkipped: number;
};

export type LocalGitMetadata = {
  branch: string | null;
  commitSha: string | null;
  modifiedFiles: number;
  untrackedFiles: number;
  deletedFiles: number;
};

export type LocalProductionVerdictResult = {
  source: "local";
  gitAvailable: boolean;
  scope: LocalAnalysisScope;
  /**
   * F9: widened from "complete"|"partial" to match
   * LocalOrchestratorPhase (local-orchestrator.ts) now that this result is
   * built from the orchestrator's own phase, not a bespoke two-value
   * approximation. "incomplete": the native engine itself failed or the
   * requested scope couldn't be honored -- findings/verdict here are a
   * best-effort fallback (see runLocalProductionVerdict), never treated as
   * authoritative history. "cancelled": the caller's AbortSignal fired.
   */
  phase: "complete" | "partial" | "incomplete" | "cancelled";
  workspace: string;
  branch: string | null;
  commitSha: string | null;
  verdictStatus: string;
  score: number | null;
  blockersCount: number;
  findings: LocalFindingPublic[];
  findingsOmittedCount: number;
  productionVerdict: Record<string, unknown>;
  snapshot: LocalSnapshotMetadata;
  git: LocalGitMetadata;
  scanMetrics: {
    inputFiles: number;
    scannedFiles: number;
    rulesRun: number;
    truncated: boolean;
  };
  narrative: string;
  methodologyNote: string;
  /**
   * F9: per-engine outcome (native + OpenGrep/Trivy/crypto/Scorecard),
   * sourced directly from the orchestrator's own LocalEngineOutcome[] --
   * additive, so a scan with an engine failure is observable through this
   * field (status/errors) rather than only visible as an aggregate `phase`.
   */
  engines: Array<{ engine: string; status: string; durationMs: number; findingsCount: number; errors: Array<{ code: string; message: string }> }>;
  correlation?: {
    ready: boolean;
    commitSha: string | null;
    branch: string | null;
    reason?: string;
  };
  /** L1.6: the real, workspace-derived identity this scan was computed against -- present so callers (e.g. history lookups) don't need a second resolveLocalIdentity() call. */
  identity: { projectId: string; repositoryId: string; workspaceId: string };
  /** L1.6: present only when `persist: true` was requested. A write failure is reported here, never hidden behind an otherwise-successful result. */
  persistence?: { status: "saved"; scanId: string } | { status: "unavailable"; error: string };
};

export type RunLocalVerdictInput = {
  workspacePath?: string;
  scope?: LocalAnalysisScope;
  gitDiffOnly?: boolean;
  /** L1.6: when true, remember this scan in the local SQLite store (lib/local-analysis/local-persistence.ts) so finding history/lifecycle can be computed across scans. Default false -- a scan remains purely in-memory unless explicitly asked to be remembered, matching local-persistence.ts's own designed default. */
  persist?: boolean;
};

export type LocalToolArgs = RunLocalVerdictInput & {
  /** L1.7/L1.8: identifies a specific finding for sequrai_local_fix, using the same correlationKey identity finding history already uses. */
  correlationKey?: string;
};
