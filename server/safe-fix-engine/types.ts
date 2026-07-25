export const SAFE_FIX_LIFECYCLE_STATES = [
  "PROPOSED",
  "READY",
  "APPROVED",
  "APPLIED",
  "VERIFYING",
  "VERIFIED",
  "FAILED",
  "SUPERSEDED",
] as const;

export type SafeFixLifecycleState = (typeof SAFE_FIX_LIFECYCLE_STATES)[number];

export const SAFE_FIX_CONFIDENCE_BANDS = ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"] as const;
export type SafeFixConfidenceBand = (typeof SAFE_FIX_CONFIDENCE_BANDS)[number];

export type SafeFixDocumentV2 = {
  executiveSummary: string;
  rootCause: string;
  whyThisMatters: string;
  riskIfIgnored: string;
  proposedImplementation: string;
  filesToChange: string[];
  expectedProductionConfidenceImprovement: number | null;
  expectedProtectionImpact: string;
  expectedSecurityImprovement: string;
  verificationChecklist: string[];
  rollbackConsiderations: string[];
  cursorPrompt: string;
  explanationNarrative: string;
};

export type SafeFixPrDraft = {
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prDescription: string;
  riskSummary: string;
  testingChecklist: string[];
  rollbackChecklist: string[];
};

export type SafeFixRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  recommendationId: string;
  reviewId: string | null;
  verdictId: string | null;
  lifecycleState: SafeFixLifecycleState;
  confidenceBand: SafeFixConfidenceBand;
  confidenceScore: number;
  document: SafeFixDocumentV2;
  prDraft: SafeFixPrDraft;
  confidenceDelta: number | null;
  protectionDelta: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SafeFixVerificationResult = {
  id: string;
  safeFixId: string;
  outcome: "passed" | "failed" | "partial";
  issueDisappeared: boolean;
  productionConfidenceImproved: boolean;
  protectionStatusImproved: boolean;
  newIssuesIntroduced: boolean;
  details: Record<string, unknown>;
};

export type SafeFixReportSummary = {
  proposed: number;
  applied: number;
  verified: number;
  failed: number;
  mostImpactfulTitle: string | null;
  confidenceGained: number | null;
};
