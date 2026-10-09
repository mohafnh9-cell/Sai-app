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

/** Tenant scope every Safe Fix access must carry, including with a client that bypasses RLS. */
export type SafeFixScope = { organizationId: string; projectId: string };

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
  /**
   * Full SHA of the commit that CONTAINS the proposed change. Null for documentary proposals (the
   * current flow), which have no commit of their own. Distinct from the base commit, which is the
   * commit of the baseline scan (`reviewId`) the proposal was generated from.
   */
  proposalCommitSha: string | null;
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
  /**
   * exact_proposal_commit: the rescan was required to be exactly the proposal's commit.
   * assisted_unbound: documentary proposal with no commit; "the finding is gone from a later scan",
   * NOT a verified automatic patch.
   */
  binding: "exact_proposal_commit" | "assisted_unbound";
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
