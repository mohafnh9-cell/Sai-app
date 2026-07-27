import type {
  BusinessLogicSpecialist,
  BusinessLogicSpecialistContext,
  BusinessLogicSpecialistPlan,
  BusinessLogicSpecialistResult,
} from "./specialist.types";
import { BaseBusinessLogicSpecialist } from "./base-business-logic-specialist";
import { selectAbuseCases, selectInvariants } from "./specialist-selection";

export class InvitationMembershipSpecialist extends BaseBusinessLogicSpecialist {
  readonly id = "logic.invitation_membership";
  readonly name = "Invitation & Membership Specialist";
  readonly version = "1.0.0";
  readonly priority = 50;

  readonly supportedWorkflowKinds: BusinessLogicSpecialist["supportedWorkflowKinds"] = [
    "invitation_referral",
  ];
  readonly supportedInvariantCategories: BusinessLogicSpecialist["supportedInvariantCategories"] = [
    "invitation_lifecycle",
    "membership_lifecycle",
    "ownership",
    "uniqueness",
  ];
  readonly supportedAbuseCategories: BusinessLogicSpecialist["supportedAbuseCategories"] = [
    "invitation_abuse",
    "membership_escalation",
    "cross_tenant_abuse",
    "reward_farming",
  ];

  protected intentPrefix = "Invitation and membership validation";
  protected defaultAssumptions = [
    "Invitation acceptance binds membership to the intended tenant or organization scope.",
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
          kind: "membership_integrity",
          title: abuseCase.title,
          detail: abuseCase.expectedOutcome,
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

    const ownershipInv = invariants.find((i) => i.category === "ownership");
    if (ownershipInv) {
      observations.push(
        this.observation({
          kind: "membership_integrity",
          title: "Ownership scope for invitations",
          detail: ownershipInv.description,
          severity: "medium",
          confidence: "highly_likely",
          workflowIds: plan.workflowIds,
          invariantIds: [ownershipInv.id],
          abuseCaseIds: abuseCases.map((a) => a.id),
          evidenceRefIds: ownershipInv.evidence.map((e) => e.id),
          unsupportedAssumptions: ownershipInv.assumptions,
        })
      );
    }

    return { observations };
  }
}
