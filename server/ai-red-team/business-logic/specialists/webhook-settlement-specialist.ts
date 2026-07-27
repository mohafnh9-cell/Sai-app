import type {
  BusinessLogicSpecialist,
  BusinessLogicSpecialistContext,
  BusinessLogicSpecialistPlan,
  BusinessLogicSpecialistResult,
} from "./specialist.types";
import { BaseBusinessLogicSpecialist } from "./base-business-logic-specialist";
import { selectAbuseCases, selectInvariants } from "./specialist-selection";

export class WebhookSettlementSpecialist extends BaseBusinessLogicSpecialist {
  readonly id = "logic.webhook_settlement";
  readonly name = "Webhook Settlement Specialist";
  readonly version = "1.0.0";
  readonly priority = 20;

  readonly supportedWorkflowKinds: BusinessLogicSpecialist["supportedWorkflowKinds"] = [
    "payment_webhook_settlement",
  ];
  readonly supportedInvariantCategories: BusinessLogicSpecialist["supportedInvariantCategories"] = [
    "webhook_ordering",
    "idempotency",
    "ordering",
    "cross_workflow_consistency",
    "retry_safety",
  ];
  readonly supportedAbuseCategories: BusinessLogicSpecialist["supportedAbuseCategories"] = [
    "webhook_replay",
    "webhook_ordering_abuse",
    "duplicate_execution",
    "retry_abuse",
    "cross_workflow_abuse",
    "stale_state",
  ];

  protected intentPrefix = "Webhook settlement validation";
  protected defaultAssumptions = [
    "Webhook handlers are idempotent and ordered relative to checkout state.",
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
          title: `Settlement abuse hypothesis: ${abuseCase.title}`,
          detail: abuseCase.expectedOutcome,
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

    const ordering = invariants.find((i) => i.category === "webhook_ordering");
    if (ordering) {
      observations.push(
        this.observation({
          kind: "settlement_dependency",
          title: "Webhook event ordering must match payment lifecycle",
          detail: ordering.description,
          severity: "high",
          confidence: "highly_likely",
          workflowIds: plan.workflowIds,
          invariantIds: [ordering.id],
          abuseCaseIds: [],
          evidenceRefIds: ordering.evidence.map((e) => e.id),
          unsupportedAssumptions: ordering.assumptions,
        })
      );
    } else {
      observations.push(
        this.observation({
          kind: "evidence_gap",
          title: "Webhook ordering invariant not extracted",
          detail:
            "Settlement workflow present but no webhook ordering invariant — replay and out-of-order delivery risks remain unbound to FSM evidence.",
          severity: "medium",
          confidence: "possible",
          workflowIds: plan.workflowIds,
          invariantIds: [],
          abuseCaseIds: [],
          evidenceRefIds: [],
          unsupportedAssumptions: [],
        })
      );
    }

    return { observations };
  }
}
