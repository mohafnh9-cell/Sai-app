import type { VerdictStatus } from "@/brain/production-verdict/schema";
import type { SecretEvidenceClassification } from "@/features/security-scanner/rules/secret-classification";
import type { ConfidenceLevel } from "@/brain/confidence/types";

export type FindingVerificationStatus =
  | "CONFIRMED"
  | "LIKELY"
  | "POTENTIAL"
  | "NOT_REPRODUCED"
  | "FALSE_POSITIVE"
  | "NOT_APPLICABLE"
  | "UNVERIFIED";

export type PostFixStatus = "FIXED" | "STILL_VULNERABLE" | "REGRESSION" | "NOT_VERIFIED";

export type AuditFindingSource = "code_review" | "security_test" | "both";

export type AuditFindingSolution = {
  whatIsWrong: string;
  whyItMatters: string;
  rootCause: string | null;
  recommendedFix: string;
  affectedFiles: string[];
  codeRecommendation: string | null;
  verificationProcedure: string;
  attackPerformed: string | null;
};

export type AuditFindingUserFacing = {
  simpleExplanation: string;
  whyItMatters: string;
  confidenceLabel: string;
  dynamicVerificationStatus: string;
  dynamicVerificationReason: string;
  whatToDo: string;
  safeToIgnore: boolean;
};

export type AuditFindingTechnicalEvidence = {
  collapsedByDefault: true;
  items: string[];
};

export type ConsolidatedAuditFinding = {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  source: AuditFindingSource;
  verificationStatus: FindingVerificationStatus;
  evidence: string[];
  confidence: "high" | "medium" | "low";
  confidenceLevel: ConfidenceLevel;
  affectedComponent: string | null;
  line?: number;
  recommendation: string | null;
  safeFixAvailable: boolean;
  staticFindingId?: string;
  attackFindingId?: string;
  adapterId?: string;
  ruleId?: string;
  secretClassification?: SecretEvidenceClassification;
  userFacing?: AuditFindingUserFacing;
  technicalEvidence?: AuditFindingTechnicalEvidence;
  solution?: AuditFindingSolution;
  postFixStatus?: PostFixStatus;
};

export type FullProductAuditPhase =
  | "queued"
  | "review_running"
  | "review_complete"
  | "security_tests_running"
  | "correlating"
  | "complete"
  | "partial";

export type FullProductAuditCounts = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  confirmed: number;
  likely: number;
  potential: number;
  notReproduced: number;
  falsePositive: number;
  notApplicable: number;
};

export type FullProductAuditEngineSummary = {
  codeReview: {
    scanId: string | null;
    findingsCount: number;
    rulesRun: number | null;
  };
  securityTesting: {
    campaignId: string | null;
    executionsRun: number;
    executionsCompleted: number;
    adaptersExecuted: string[];
    adaptersSelectedFromFindings: string[];
    runtimeMode: string | null;
    dynamicTargetSource: string | null;
    skippedReason: string | null;
    notSafelyTestableCount: number;
  };
};

export type DynamicVerificationSummary = {
  offered: boolean;
  decision: "authorize" | "static_only" | null;
  authorizedTarget: string | null;
  awaitingUrl: boolean;
  awaitingAuthorization: boolean;
  awaitingScopeApproval: boolean;
  notSafelyTestableCount: number;
};

export type FullProductAuditResult = {
  mode: "full_product_audit";
  phase: FullProductAuditPhase;
  project: { id: string; name: string; repositoryFullName: string | null };
  reviewId: string | null;
  commitSha: string | null;
  verdictStatus: VerdictStatus | null;
  score: number | null;
  counts: FullProductAuditCounts;
  topRisks: ConsolidatedAuditFinding[];
  whatToFixFirst: string[];
  findings: ConsolidatedAuditFinding[];
  engines: FullProductAuditEngineSummary;
  dynamicVerification: DynamicVerificationSummary;
  safeFixAvailable: boolean;
  safeFixBlockerId: string | null;
  recommendation: string;
  summary: string;
  timedOut: boolean;
  nextAction: string;
};
