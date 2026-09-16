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
  filePath: string;
  line: number;
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
  phase: "complete" | "partial";
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
