import type { ConfidenceBand } from "../intelligence/models";
import type { SecurityIntelligenceReport } from "../intelligence/models";

export type SecurityDecisionType =
  | "APPROVE_DEPLOYMENT"
  | "APPROVE_WITH_WARNINGS"
  | "REQUIRES_VERIFICATION"
  | "BLOCK_DEPLOYMENT"
  | "INSUFFICIENT_EVIDENCE";

/** Canonical deployment verdict — only the Decision Engine produces these. */
export type SecurityDeploymentVerdictStatus =
  | "SAFE_TO_DEPLOY"
  | "DEPLOY_WITH_WARNINGS"
  | "DO_NOT_DEPLOY"
  | "INSUFFICIENT_EVIDENCE";

export type SecurityDecisionAction = {
  id: string;
  label: string;
  kind:
    | "run_team"
    | "run_replay"
    | "apply_safe_fix"
    | "block_deploy"
    | "continue"
    | "rotate_credentials"
    | "manual_investigation";
  required: boolean;
};

export type SecurityDecision = {
  decisionId: string;
  decision: SecurityDecisionType;
  deploymentVerdict: SecurityDeploymentVerdictStatus;
  summary: string;
  technicalReasoning: string;
  businessReasoning: string;
  evidenceUsed: string[];
  evidenceMissing: string[];
  confidence: ConfidenceBand;
  requiredActions: SecurityDecisionAction[];
  primaryRecommendation: string;
  policiesTriggered: string[];
  policyVersion: string;
  generatedAt: string;
  metadata?: Record<string, unknown>;
};

export type FounderDecisionExplanation = {
  headline: string;
  body: string[];
};

export type EngineerDecisionExplanation = {
  policiesTriggered: string[];
  coverageSummary: string;
  attackChains: string[];
  rootCauses: string[];
  confidence: ConfidenceBand;
  evidenceUsed: string[];
  evidenceMissing: string[];
};

export type SecurityDecisionExplanation = {
  founder: FounderDecisionExplanation;
  engineer: EngineerDecisionExplanation;
};

export type DecisionHistoryEntry = {
  id: string;
  projectId: string;
  commitSha: string | null;
  previousDecision: SecurityDecisionType | null;
  decision: SecurityDecisionType;
  previousDeploymentVerdict: SecurityDeploymentVerdictStatus | null;
  deploymentVerdict: SecurityDeploymentVerdictStatus;
  confidence: ConfidenceBand;
  policyVersion: string;
  reasonSummary: string;
  recordedAt: string;
};

export type AcceptedRiskRecord = {
  id: string;
  findingId: string;
  owner: string;
  reason: string;
  expiration: string;
  approvedBy: string;
  reviewDate: string;
};

export type SecurityDecisionReport = {
  decision: SecurityDecision;
  explanation: SecurityDecisionExplanation;
  coverageScore: number;
  coverageGaps: string[];
  historyEntry: DecisionHistoryEntry | null;
};

export type DecisionEngineInput = {
  intelligence: SecurityIntelligenceReport;
  context: import("./decision-context").DecisionContext;
};

export const DECISION_POLICY_VERSION = "rt5-v1";

export function mapDecisionToDeploymentVerdict(
  decision: SecurityDecisionType
): SecurityDeploymentVerdictStatus {
  switch (decision) {
    case "APPROVE_DEPLOYMENT":
      return "SAFE_TO_DEPLOY";
    case "APPROVE_WITH_WARNINGS":
      return "DEPLOY_WITH_WARNINGS";
    case "BLOCK_DEPLOYMENT":
      return "DO_NOT_DEPLOY";
    case "REQUIRES_VERIFICATION":
    case "INSUFFICIENT_EVIDENCE":
      return "INSUFFICIENT_EVIDENCE";
  }
}

export function mapDeploymentVerdictToDecisionType(
  status: SecurityDeploymentVerdictStatus
): SecurityDecisionType {
  switch (status) {
    case "SAFE_TO_DEPLOY":
      return "APPROVE_DEPLOYMENT";
    case "DEPLOY_WITH_WARNINGS":
      return "APPROVE_WITH_WARNINGS";
    case "DO_NOT_DEPLOY":
      return "BLOCK_DEPLOYMENT";
    case "INSUFFICIENT_EVIDENCE":
      return "INSUFFICIENT_EVIDENCE";
  }
}
