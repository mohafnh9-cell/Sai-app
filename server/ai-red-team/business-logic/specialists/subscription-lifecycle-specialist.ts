import type {
  BusinessLogicSpecialist,
  BusinessLogicSpecialistContext,
  BusinessLogicSpecialistPlan,
  BusinessLogicSpecialistResult,
} from "./specialist.types";
import { BaseBusinessLogicSpecialist } from "./base-business-logic-specialist";
import { selectAbuseCases, selectInvariants } from "./specialist-selection";

export class SubscriptionLifecycleSpecialist extends BaseBusinessLogicSpecialist {
  readonly id = "logic.subscription_lifecycle";
  readonly name = "Subscription Lifecycle Specialist";
  readonly version = "1.0.0";
  readonly priority = 30;

  readonly supportedWorkflowKinds: BusinessLogicSpecialist["supportedWorkflowKinds"] = [
    "subscription_lifecycle",
  ];
  readonly supportedInvariantCategories: BusinessLogicSpecialist["supportedInvariantCategories"] = [
    "subscription_lifecycle",
    "entitlement_consistency",
    "temporal_constraints",
    "payment_lifecycle",
  ];
  readonly supportedAbuseCategories: BusinessLogicSpecialist["supportedAbuseCategories"] = [
    "subscription_resurrection",
    "trial_replay",
    "entitlement_abuse",
    "rollback_abuse",
    "state_skipping",
  ];

  protected intentPrefix = "Subscription lifecycle validation";
  protected defaultAssumptions = [
    "Subscription state transitions are enforced server-side.",
  ];

  async analyze(
    context: BusinessLogicSpecialistContext,
    plan: BusinessLogicSpecialistPlan
  ): Promise<Pick<BusinessLogicSpecialistResult, "observations">> {
    const observations = [];
    const invariants = selectInvariants({
      context,
      workflowIds: plan.workflowIds,
      categories: [...this.supportedInvariantCategories],
    });
    const abuseCases = selectAbuseCases({
      context,
      invariantIds: plan.invariantIds,
      categories: [...this.supportedAbuseCategories],
    });

    for (const abuseCase of abuseCases) {
      observations.push(
        this.observation({
          kind: "hypothesis_alignment",
          title: abuseCase.title,
          detail: abuseCase.businessImpact,
          severity: "medium",
          confidence: "likely",
          workflowIds: plan.workflowIds,
          invariantIds: [abuseCase.targetInvariantId],
          abuseCaseIds: [abuseCase.id],
          evidenceRefIds: abuseCase.evidence.map((e) => e.id),
          unsupportedAssumptions: abuseCase.assumptions.map((a) => a.statement),
        })
      );
    }

    const lifecycleInv = invariants.find((i) => i.category === "subscription_lifecycle");
    if (lifecycleInv) {
      observations.push(
        this.observation({
          kind: "lifecycle_integrity",
          title: "Subscription lifecycle invariant under review",
          detail: lifecycleInv.potentialImpact,
          severity: "medium",
          confidence: "highly_likely",
          workflowIds: plan.workflowIds,
          invariantIds: [lifecycleInv.id],
          abuseCaseIds: abuseCases.map((a) => a.id),
          evidenceRefIds: lifecycleInv.evidence.map((e) => e.id),
          unsupportedAssumptions: lifecycleInv.assumptions,
        })
      );
    }

    return { observations };
  }
}
