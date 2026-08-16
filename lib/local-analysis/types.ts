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
};

export type RunLocalVerdictInput = {
  workspacePath?: string;
  scope?: LocalAnalysisScope;
  gitDiffOnly?: boolean;
};

export type LocalToolArgs = RunLocalVerdictInput;
