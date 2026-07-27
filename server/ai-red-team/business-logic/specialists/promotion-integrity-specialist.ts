import type {
  BusinessLogicSpecialist,
  BusinessLogicSpecialistContext,
  BusinessLogicSpecialistPlan,
  BusinessLogicSpecialistResult,
} from "./specialist.types";
import { BaseBusinessLogicSpecialist } from "./base-business-logic-specialist";
import { selectAbuseCases, selectInvariants } from "./specialist-selection";

export class PromotionIntegritySpecialist extends BaseBusinessLogicSpecialist {
  readonly id = "logic.promotion_integrity";
  readonly name = "Promotion & Credit Integrity Specialist";
  readonly version = "1.0.0";
  readonly priority = 40;

  readonly supportedWorkflowKinds: BusinessLogicSpecialist["supportedWorkflowKinds"] = [
    "coupon_redemption",
    "credit_quota",
  ];
  readonly supportedInvariantCategories: BusinessLogicSpecialist["supportedInvariantCategories"] = [
    "coupon_lifecycle",
    "credit_integrity",
    "quota_integrity",
    "uniqueness",
    "idempotency",
  ];
  readonly supportedAbuseCategories: BusinessLogicSpecialist["supportedAbuseCategories"] = [
    "coupon_replay",
    "credit_duplication",
    "quota_bypass",
    "duplicate_execution",
    "reward_farming",
  ];

  protected intentPrefix = "Promotion and credit validation";
  protected defaultAssumptions = [
    "Coupons and credits are consumed atomically with usage limits enforced server-side.",
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
          kind: "promotion_integrity",
          title: abuseCase.title,
          detail: abuseCase.description,
          severity: "medium",
          confidence: "likely",
          workflowIds: [abuseCase.targetWorkflowId],
          invariantIds: [abuseCase.targetInvariantId],
          abuseCaseIds: [abuseCase.id],
          evidenceRefIds: abuseCase.evidence.map((e) => e.id),
          unsupportedAssumptions: abuseCase.assumptions.map((a) => a.statement),
        })
      );
    }

    if (invariants.length === 0) {
      observations.push(
        this.observation({
          kind: "evidence_gap",
          title: "Promotion workflows without extracted invariants",
          detail:
            "Coupon or credit workflows were discovered but no matching invariants — promotion abuse hypotheses may be under-specified.",
          severity: "low",
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
