import type { BusinessValueKind } from "../model/domain.types";

export type BusinessAbuseCategory =
  | "workflow_bypass"
  | "state_skipping"
  | "invalid_ordering"
  | "duplicate_execution"
  | "double_spend"
  | "credit_duplication"
  | "coupon_replay"
  | "trial_replay"
  | "subscription_resurrection"
  | "quota_bypass"
  | "entitlement_abuse"
  | "invitation_abuse"
  | "membership_escalation"
  | "reward_farming"
  | "webhook_replay"
  | "webhook_ordering_abuse"
  | "concurrent_execution"
  | "race_condition"
  | "stale_state"
  | "retry_abuse"
  | "rollback_abuse"
  | "cross_workflow_abuse"
  | "cross_tenant_abuse"
  | "business_value_extraction"
  | "economic_abuse";

export type BusinessAbuseSeverity = "low" | "medium" | "high" | "critical";

export type BusinessAbuseConfidence =
  | "confirmed"
  | "highly_likely"
  | "likely"
  | "possible"
  | "unsupported";

export type BusinessAbuseEvidence = {
  id: string;
  source: "invariant" | "fsm_transition" | "discovery" | "workflow";
  detail: string;
  confidence: number;
  refId?: string | null;
};

export type BusinessAbuseAssumption = {
  id: string;
  statement: string;
  required: boolean;
};

export type BusinessAbuseAction = {
  id: string;
  kind: "invoke_event" | "repeat_request" | "parallel_request" | "rollback_trigger" | "out_of_band";
  label: string;
  event: string | null;
  actorRole: string;
};

export type BusinessAbuseSequenceStep = {
  order: number;
  stateId: string;
  stateName: string;
  action: BusinessAbuseAction;
  transitionId: string | null;
  transitionEvent: string | null;
  toStateId: string | null;
  toStateName: string | null;
  note: string | null;
};

export type BusinessAbuseSequence = {
  id: string;
  steps: BusinessAbuseSequenceStep[];
  invariantViolationSummary: string;
  businessConsequence: string;
};

export type BusinessAbuseCase = {
  id: string;
  abuseKey: string;
  title: string;
  description: string;
  category: BusinessAbuseCategory;
  severity: BusinessAbuseSeverity;
  confidence: BusinessAbuseConfidence;
  targetInvariantId: string;
  targetInvariantKey: string;
  targetWorkflowId: string;
  targetWorkflowKind: string;
  targetStateMachineId: string;
  targetEntityIds: string[];
  targetStateIds: string[];
  actorRole: string;
  sequence: BusinessAbuseSequence;
  businessImpact: string;
  affectedValueKind: BusinessValueKind;
  evidence: BusinessAbuseEvidence[];
  assumptions: BusinessAbuseAssumption[];
  expectedOutcome: string;
  mitigationHints: string[];
};

export type BusinessAbuseValidationIssue = {
  id: string;
  abuseCaseId: string;
  code:
    | "contradicts_fsm"
    | "impossible_transition"
    | "unsupported_assumption_only"
    | "missing_invariant"
    | "speculative";
  message: string;
};

export type BusinessAbuseCollection = {
  id: string;
  cases: BusinessAbuseCase[];
  validationIssues: BusinessAbuseValidationIssue[];
  generatedAt: string;
};

export type BusinessAbuseResult = {
  collection: BusinessAbuseCollection;
  plannedInvariantCount: number;
  generatedCount: number;
  acceptedCount: number;
  rejectedCount: number;
};

export type AbuseGenerationInput = {
  domain: import("../model/domain.types").BusinessDomainModel;
};

/** Extension point for future specialist packs — register strategies without changing the core loop. */
export type AbuseStrategy = {
  id: string;
  invariantCategories: import("../invariants/invariant.types").BusinessInvariantCategory[];
  generate: (ctx: AbuseStrategyContext) => BusinessAbuseCase[];
};

export type AbuseStrategyContext = {
  invariant: import("../invariants/invariant.types").BusinessInvariant;
  workflow: import("../model/domain.types").BusinessWorkflow;
  machine: import("../model/domain.types").BusinessStateMachine;
  entities: import("../model/domain.types").BusinessEntity[];
};
