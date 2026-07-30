export type SecurityTestStepId = "choose" | "run" | "fix" | "verify";

export type SecurityTestStepStatus = "done" | "current" | "upcoming";

export type SecurityTestPhase =
  | "needs_review"
  | "preparing"
  | "ready"
  | "running"
  | "issues_found"
  | "fix_ready"
  | "protected"
  | "completed_clean";

export type SecurityTestOption = {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  categoryLabel: string;
  recommended: boolean;
};

export type SecurityTestProgressStep = {
  id: SecurityTestStepId;
  label: string;
  status: SecurityTestStepStatus;
};

export type SecurityTestCampaignSummary = {
  id: string;
  status: string;
  progressPercent: number;
  confirmedFindings: number;
  totalExecutions: number;
  completedExecutions: number;
  commitSha: string;
};

export type SecurityTestScanSummary = {
  id: string;
  scanJobId: string | null;
  commitSha: string;
};

export type SecurityTestContext = {
  phase: SecurityTestPhase;
  headline: string;
  description: string;
  primaryActionLabel: string;
  secondaryActionLabel: string | null;
  reviewInProgress: boolean;
  latestScan: SecurityTestScanSummary | null;
  campaign: SecurityTestCampaignSummary | null;
  availableTests: SecurityTestOption[];
  progressSteps: SecurityTestProgressStep[];
  attackCenterHref: string;
};
