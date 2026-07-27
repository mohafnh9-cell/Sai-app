import type { BusinessValueKind } from "../model/domain.types";

export type BusinessInvariantConfidenceLevel =
  | "explicit"
  | "confirmed"
  | "strongly_inferred"
  | "inferred"
  | "assumed"
  | "unsupported";

export type BusinessInvariantCategory =
  | "ordering"
  | "uniqueness"
  | "ownership"
  | "balance_consistency"
  | "entitlement_consistency"
  | "subscription_lifecycle"
  | "payment_lifecycle"
  | "quota_integrity"
  | "credit_integrity"
  | "invitation_lifecycle"
  | "membership_lifecycle"
  | "coupon_lifecycle"
  | "reward_lifecycle"
  | "webhook_ordering"
  | "retry_safety"
  | "idempotency"
  | "concurrency"
  | "temporal_constraints"
  | "cross_workflow_consistency";

export type BusinessInvariantSource =
  | "workflow_ordering"
  | "fsm_transition"
  | "terminal_state"
  | "rollback_behaviour"
  | "ownership_model"
  | "business_constraint"
  | "entity_lifecycle"
  | "transaction_ordering"
  | "discovery_evidence"
  | "authentication_assumption"
  | "authorization_assumption";

export type BusinessInvariantEvidence = {
  id: string;
  source: BusinessInvariantSource;
  detail: string;
  confidence: number;
  refId?: string | null;
};

export type BusinessInvariant = {
  id: string;
  invariantKey: string;
  title: string;
  description: string;
  whyItExists: string;
  protectedValueKind: BusinessValueKind;
  protectedValueDescription: string;
  category: BusinessInvariantCategory;
  confidence: BusinessInvariantConfidenceLevel;
  workflowId: string;
  stateMachineId: string;
  entityIds: string[];
  actorIds: string[];
  supportingTransitionIds: string[];
  relatedConstraintIds: string[];
  potentialImpact: string;
  assumptions: string[];
  evidence: BusinessInvariantEvidence[];
};

export type BusinessInvariantGroup = {
  id: string;
  workflowId: string;
  workflowKind: string;
  label: string;
  invariantIds: string[];
};

export type BusinessInvariantViolation = {
  id: string;
  invariantId: string;
  code: "missing_evidence" | "missing_workflow_ref" | "missing_fsm_ref" | "unsupported_confidence";
  message: string;
};

export type BusinessInvariantCollection = {
  id: string;
  groups: BusinessInvariantGroup[];
  invariants: BusinessInvariant[];
  validationViolations: BusinessInvariantViolation[];
  extractedAt: string;
};

export type InvariantExtractionInput = {
  domain: import("../model/domain.types").BusinessDomainModel;
  discoverySignals: import("../discovery/discovery.types").BusinessDiscoverySignals;
};
