import type { BusinessValueKind } from "../model/domain.types";
import type { BusinessAbuseCategory } from "../abuse/abuse.types";
import type { CoreFindingSeverity } from "../../core/severity/severity.types";
import type { CoreFindingConfidence } from "../../core/confidence/confidence.types";
import type { CoreFindingStatus } from "../../core/findings/finding.types";
import type { CoreEvidence } from "../../core/evidence/evidence.types";

export type BusinessLogicFindingSeverity = CoreFindingSeverity;

export type BusinessLogicFindingConfidence = CoreFindingConfidence;

export type BusinessLogicFindingStatus = CoreFindingStatus;

export type BusinessLogicFindingCategory =
  | "invariant_violation"
  | "abuse_execution"
  | "workflow_inconsistency"
  | "economic_inconsistency";

export type BusinessLogicFindingEvidence = CoreEvidence<
  "runtime" | "invariant" | "abuse" | "specialist" | "fsm"
> & {
  refId: string | null;
  executionId: string | null;
};

export type BusinessLogicFindingCorrelation = {
  keys: string[];
  workflowId: string;
  invariantId: string;
  invariantKey: string;
  abuseCaseId: string | null;
  abuseKey: string | null;
  workflowKind: string;
  businessValueKind: BusinessValueKind;
};

export type BusinessLogicFindingRecommendation = {
  id: string;
  kind:
    | "restore_invariant"
    | "protect_workflow_step"
    | "validate_transition"
    | "ownership_rule"
    | "ordering_rule"
    | "idempotency"
    | "concurrency";
  statement: string;
};

export type BusinessLogicFindingMitigation = {
  summary: string;
  recommendations: BusinessLogicFindingRecommendation[];
  hintsFromAbuse: string[];
};

export type BusinessReplayAction = {
  id: string;
  order: number;
  kind: "invoke_transition" | "repeat_action" | "parallel_action" | "assert_invariant";
  label: string;
  transitionId: string | null;
  event: string | null;
};

export type BusinessReplaySequence = {
  id: string;
  steps: BusinessReplayAction[];
};

export type BusinessReplayEvidence = {
  id: string;
  detail: string;
  refId: string | null;
};

export type BusinessReplayPlan = {
  id: string;
  findingId: string;
  preconditions: string[];
  sequence: BusinessReplaySequence;
  expectedOutcome: string;
  validationCriteria: string[];
  evidence: BusinessReplayEvidence[];
  /** RT11 executes later — not run in Slice 7. */
  executable: boolean;
};

export type BusinessLogicFindingMetadata = {
  businessLogicTeamRunId: string | null;
  executionId: string;
  planId: string;
  specialistId: string;
  executionMode: string;
  executionClassification: string;
  abuseCategory: BusinessAbuseCategory | null;
  generatedAt: string;
};

export type BusinessLogicFinding = {
  findingId: string;
  findingKey: string;
  title: string;
  description: string;
  category: BusinessLogicFindingCategory;
  severity: BusinessLogicFindingSeverity;
  confidence: BusinessLogicFindingConfidence;
  status: BusinessLogicFindingStatus;
  workflowId: string;
  workflowKind: string;
  entityIds: string[];
  invariantIds: string[];
  invariantKeys: string[];
  transitionIds: string[];
  specialistIds: string[];
  businessImpact: string;
  economicImpact: string;
  replayPlan: BusinessReplayPlan;
  mitigation: BusinessLogicFindingMitigation;
  evidence: BusinessLogicFindingEvidence[];
  supportingAssumptions: string[];
  executionSummary: string;
  correlation: BusinessLogicFindingCorrelation;
  metadata: BusinessLogicFindingMetadata;
};

export type BusinessLogicFindingCollection = {
  id: string;
  generatedAt: string;
  findings: BusinessLogicFinding[];
  validationIssues: { findingId: string; code: string; message: string }[];
};

export type FindingBuildInput = {
  domain: import("../model/domain.types").BusinessDomainModel;
  businessLogicTeamRunId?: string | null;
};
