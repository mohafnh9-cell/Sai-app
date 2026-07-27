import type { DiscoveredBusinessWorkflowKind } from "../discovery/discovery.types";
import type { BusinessAbuseCase } from "../abuse/abuse.types";
import type { BusinessInvariant } from "../invariants/invariant.types";
import type { BusinessDomainModel } from "../model/domain.types";
import type { BusinessLogicSpecialistExecutionSummary } from "../specialists/specialist.types";
import type {
  BusinessLogicExecutionMode,
  BusinessLogicExecutionPlan,
  BusinessLogicMockScenarioKind,
  BusinessLogicRuntimeLimits,
  BusinessLogicRuntimeProfile,
} from "./runtime.types";
import { DEFAULT_BUSINESS_LOGIC_RUNTIME_LIMITS, DEFAULT_BUSINESS_LOGIC_RUNTIME_PROFILE } from "./runtime.config";

function scenarioForWorkflowKind(
  kind: string,
  abuseCase: BusinessAbuseCase | null
): BusinessLogicMockScenarioKind {
  if (abuseCase?.category === "quota_bypass") return "quota";
  if (abuseCase?.category === "race_condition" || abuseCase?.category === "concurrent_execution") {
    return "race_condition";
  }
  if (abuseCase?.category === "retry_abuse") return "retry";
  if (abuseCase?.category === "state_skipping" || abuseCase?.category === "invalid_ordering") {
    return "state_transition";
  }

  switch (kind as DiscoveredBusinessWorkflowKind) {
    case "payment_checkout":
      return "checkout";
    case "subscription_lifecycle":
      return "subscription";
    case "credit_quota":
      return "credits";
    case "coupon_redemption":
      return "coupon";
    case "invitation_referral":
      return "invitation";
    case "payment_webhook_settlement":
      return "webhook";
    default:
      return "state_transition";
  }
}

function resolveExecutionMode(input: {
  validationMode: "static_review" | "future_runtime" | "future_replay";
  profile: BusinessLogicRuntimeProfile;
}): BusinessLogicExecutionMode {
  if (input.validationMode === "static_review") return "static_validation";
  if (input.validationMode === "future_replay") return "simulation_only";
  if (input.profile.allowStagingCandidate) return "staging_candidate";
  return "mock_runtime";
}

function findInvariant(domain: BusinessDomainModel, id: string): BusinessInvariant | null {
  return domain.invariantCollection?.invariants.find((i) => i.id === id) ?? null;
}

function findAbuse(domain: BusinessDomainModel, id: string | null): BusinessAbuseCase | null {
  if (!id) return null;
  return domain.abuseCollection?.cases.find((c) => c.id === id) ?? null;
}

export function planBusinessLogicExecutions(input: {
  domain: BusinessDomainModel;
  specialistSummary: BusinessLogicSpecialistExecutionSummary;
  profile?: BusinessLogicRuntimeProfile;
  limits?: BusinessLogicRuntimeLimits;
}): BusinessLogicExecutionPlan[] {
  const profile = input.profile ?? DEFAULT_BUSINESS_LOGIC_RUNTIME_PROFILE;
  const limits = input.limits ?? DEFAULT_BUSINESS_LOGIC_RUNTIME_LIMITS;
  const plans: BusinessLogicExecutionPlan[] = [];

  for (const specialistResult of input.specialistSummary.results) {
    if (specialistResult.status !== "completed" || !specialistResult.plan) continue;

    for (const step of specialistResult.plan.validationSteps) {
      const invariant = findInvariant(input.domain, step.targetInvariantId);
      if (!invariant) continue;

      const workflow =
        input.domain.workflows.find((w) => w.id === invariant.workflowId) ?? null;
      if (!workflow) continue;

      const abuseCase = findAbuse(input.domain, step.targetAbuseCaseId);
      const workflowKind =
        workflow.metadata.discoveredWorkflowKind ?? workflow.kind;

      const mode = resolveExecutionMode({
        validationMode: step.validationMode,
        profile,
      });

      plans.push({
        id: step.id,
        specialistPlanId: specialistResult.plan.id,
        specialistId: specialistResult.specialistId,
        specialistStepId: step.id,
        workflowId: workflow.id,
        workflowKind,
        scenarioKind: scenarioForWorkflowKind(workflowKind, abuseCase),
        requiredEntityIds: invariant.entityIds,
        transitionIds: invariant.supportingTransitionIds,
        targetInvariantId: invariant.id,
        targetAbuseCaseId: abuseCase?.id ?? null,
        assumptions: [
          ...specialistResult.plan.assumptions,
          ...invariant.assumptions,
          ...(abuseCase?.assumptions.map((a) => a.statement) ?? []),
        ],
        requiredEvidenceRefIds: step.evidenceRefIds,
        executionMode: mode === "staging_candidate" && !profile.allowStagingCandidate ? "mock_runtime" : mode,
        maxEvaluations: limits.perPlanMaxEvaluations,
        timeoutMs: limits.perPlanTimeoutMs,
        rollbackStrategy: "mock_reset",
      });
    }
  }

  return plans;
}

export const BusinessLogicExecutionPlanner = {
  planFromSpecialists: planBusinessLogicExecutions,
};
