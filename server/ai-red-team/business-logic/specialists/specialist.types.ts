import type { DiscoveryReport } from "../../discovery/types";
import type { BusinessDomainModel } from "../model/domain.types";
import type {
  BusinessDiscoverySignals,
  DiscoveredBusinessWorkflow,
} from "../discovery/discovery.types";
import type { BusinessInvariantCategory } from "../invariants/invariant.types";
import type { BusinessAbuseCategory } from "../abuse/abuse.types";
import type { DiscoveredBusinessWorkflowKind } from "../discovery/discovery.types";

export type BusinessLogicSpecialistStatus = "completed" | "skipped" | "failed";

export type BusinessLogicSpecialistEligibility = {
  eligible: boolean;
  reason: string;
  matchedWorkflowKinds: DiscoveredBusinessWorkflowKind[];
  matchedWorkflowIds: string[];
};

export type BusinessLogicSpecialistValidationStep = {
  id: string;
  order: number;
  intent: string;
  targetInvariantId: string;
  targetAbuseCaseId: string | null;
  /** Slice 5: static planning only — runtime execution is a later slice. */
  validationMode: "static_review" | "future_runtime" | "future_replay";
  evidenceRefIds: string[];
};

export type BusinessLogicSpecialistPlan = {
  id: string;
  specialistId: string;
  workflowIds: string[];
  invariantIds: string[];
  abuseCaseIds: string[];
  validationSteps: BusinessLogicSpecialistValidationStep[];
  boundedStepCount: number;
  assumptions: string[];
  selectionRationale: string;
};

export type BusinessLogicSpecialistObservationKind =
  | "checkout_integrity"
  | "settlement_dependency"
  | "lifecycle_integrity"
  | "promotion_integrity"
  | "membership_integrity"
  | "hypothesis_alignment"
  | "evidence_gap"
  | "assumption_risk";

export type BusinessLogicSpecialistObservation = {
  id: string;
  specialistId: string;
  kind: BusinessLogicSpecialistObservationKind;
  title: string;
  detail: string;
  severity: "info" | "low" | "medium" | "high";
  confidence: "confirmed" | "highly_likely" | "likely" | "possible";
  workflowIds: string[];
  invariantIds: string[];
  abuseCaseIds: string[];
  evidenceRefIds: string[];
  unsupportedAssumptions: string[];
};

export type BusinessLogicSpecialistFailure = {
  code: "analyze_error" | "plan_error" | "internal";
  message: string;
};

export type BusinessLogicSpecialistResult = {
  specialistId: string;
  specialistName: string;
  status: BusinessLogicSpecialistStatus;
  eligibility: BusinessLogicSpecialistEligibility;
  plan: BusinessLogicSpecialistPlan | null;
  observations: BusinessLogicSpecialistObservation[];
  failure: BusinessLogicSpecialistFailure | null;
  summary: string;
  durationMs: number;
};

export type BusinessLogicSpecialistExecutionSummary = {
  id: string;
  generatedAt: string;
  specialistsTotal: number;
  specialistsCompleted: number;
  specialistsSkipped: number;
  specialistsFailed: number;
  observationCount: number;
  results: BusinessLogicSpecialistResult[];
};

export type BusinessLogicSpecialistContext = {
  businessLogicTeamRunId: string;
  redTeamRunId: string;
  organizationId: string;
  projectId: string;
  discovery: DiscoveryReport;
  signals: BusinessDiscoverySignals;
  discoveredWorkflows: DiscoveredBusinessWorkflow[];
  domain: BusinessDomainModel;
};

export interface BusinessLogicSpecialist {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly priority: number;
  readonly supportedWorkflowKinds: DiscoveredBusinessWorkflowKind[];
  readonly supportedInvariantCategories: BusinessInvariantCategory[];
  readonly supportedAbuseCategories: BusinessAbuseCategory[];

  canRun(
    context: BusinessLogicSpecialistContext
  ): BusinessLogicSpecialistEligibility | Promise<BusinessLogicSpecialistEligibility>;

  plan(context: BusinessLogicSpecialistContext): Promise<BusinessLogicSpecialistPlan>;

  analyze(
    context: BusinessLogicSpecialistContext,
    plan: BusinessLogicSpecialistPlan
  ): Promise<Pick<BusinessLogicSpecialistResult, "observations">>;

  summarize(result: BusinessLogicSpecialistResult): string;
}

export const BUSINESS_LOGIC_SPECIALIST_MAX_VALIDATION_STEPS = 12;
