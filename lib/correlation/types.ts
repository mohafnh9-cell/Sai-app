export type FindingCorrelationStatus =
  | "matched"
  | "unmatched"
  | "resolved"
  | "changed"
  | "ambiguous";

export type LocalFindingCorrelationInput = {
  ruleId: string;
  filePath: string;
  line?: number | null;
  severity: string;
  title?: string | null;
  correlationKey?: string | null;
  fingerprintMaterial?: string | null;
};

export type GitHubFindingSnapshot = {
  id: string;
  ruleId: string;
  filePath: string;
  line: number;
  severity: string;
  status: string;
  correlationKey: string;
  scanId: string;
  commitSha: string | null;
};

export type FindingCorrelationResult = {
  status: FindingCorrelationStatus;
  correlationKey: string;
  local: {
    ruleId: string;
    filePath: string;
    line?: number | null;
    severity: string;
    title?: string | null;
  };
  github?: {
    findingId: string;
    ruleId: string;
    filePath: string;
    line: number;
    severity: string;
    status: string;
    scanId: string;
    commitSha: string | null;
  };
  candidates?: number;
  reason?: string;
};

export type CommitCorrelation = {
  status: "matched" | "unmatched" | "ambiguous";
  localCommitSha: string | null;
  githubCommitSha: string | null;
  reason?: string;
};

export type PullRequestCorrelation = {
  status: "matched" | "unmatched" | "ambiguous";
  pullRequestNumber?: number;
  headCommitSha?: string;
  reason?: string;
};

export type LocalGitHubCorrelationSummary = {
  source: "local";
  githubAuthoritative: true;
  projectId: string;
  organizationId: string;
  githubRepo: string | null;
  commit: CommitCorrelation;
  pullRequest: PullRequestCorrelation;
  githubVerdictStatus: string | null;
  findings: FindingCorrelationResult[];
};
