import type {
  BusinessLogicSpecialist,
  BusinessLogicSpecialistContext,
  BusinessLogicSpecialistPlan,
  BusinessLogicSpecialistResult,
} from "./specialist.types";
import { BaseBusinessLogicSpecialist } from "./base-business-logic-specialist";
import { selectAbuseCases, selectInvariants } from "./specialist-selection";

export class CheckoutIntegritySpecialist extends BaseBusinessLogicSpecialist {
  readonly id = "logic.checkout_integrity";
  readonly name = "Checkout Integrity Specialist";
  readonly version = "1.0.0";
  readonly priority = 10;

  readonly supportedWorkflowKinds: BusinessLogicSpecialist["supportedWorkflowKinds"] = [
    "payment_checkout",
  ];
  readonly supportedInvariantCategories: BusinessLogicSpecialist["supportedInvariantCategories"] = [
    "ordering",
    "payment_lifecycle",
    "cross_workflow_consistency",
    "idempotency",
  ];
  readonly supportedAbuseCategories: BusinessLogicSpecialist["supportedAbuseCategories"] = [
    "workflow_bypass",
    "invalid_ordering",
    "state_skipping",
    "double_spend",
    "cross_workflow_abuse",
  ];

  protected intentPrefix = "Checkout integrity validation";
  protected defaultAssumptions = [
    "Checkout workflow reflects server-side settlement gates (not UI-only).",
    "Monetary amounts are authoritative on the server or payment provider.",
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
          title: `Checkout abuse hypothesis: ${abuseCase.title}`,
          detail: abuseCase.expectedOutcome,
          severity: abuseCase.severity === "critical" ? "high" : "medium",
          confidence:
            abuseCase.confidence === "confirmed"
              ? "confirmed"
              : abuseCase.confidence === "highly_likely"
                ? "highly_likely"
                : "likely",
          workflowIds: [abuseCase.targetWorkflowId],
          invariantIds: [abuseCase.targetInvariantId],
          abuseCaseIds: [abuseCase.id],
          evidenceRefIds: abuseCase.evidence.map((e) => e.id),
          unsupportedAssumptions: abuseCase.assumptions.map((a) => a.statement),
        })
      );
    }

    const orderingInvariant = invariants.find((i) => i.category === "ordering");
    if (orderingInvariant) {
      observations.push(
        this.observation({
          kind: "checkout_integrity",
          title: "Fulfillment must not precede confirmed payment",
          detail:
            "Ordering invariant detected on checkout — plan validates that fulfillment, entitlement grant, or order completion cannot occur before payment confirmation.",
          severity: "high",
          confidence: "highly_likely",
          workflowIds: plan.workflowIds,
          invariantIds: [orderingInvariant.id],
          abuseCaseIds: [],
          evidenceRefIds: orderingInvariant.evidence.map((e) => e.id),
          unsupportedAssumptions: orderingInvariant.assumptions,
        })
      );
    }

    const hasMonetaryResource = context.domain.entities.some(
      (e) => e.kind === "payment" || e.kind === "order"
    );
    if (hasMonetaryResource) {
      observations.push(
        this.observation({
          kind: "checkout_integrity",
          title: "Client-controlled price or amount risk surface",
          detail:
            "Payment or order entities were discovered — validation plan includes static review for server-side amount authority (no client-supplied totals without provider verification).",
          severity: "medium",
          confidence: "likely",
          workflowIds: plan.workflowIds,
          invariantIds: invariants.map((i) => i.id),
          abuseCaseIds: abuseCases
            .filter((a) => a.category === "double_spend" || a.category === "workflow_bypass")
            .map((a) => a.id),
          evidenceRefIds: context.domain.entities
            .filter((e) => e.kind === "payment" || e.kind === "order")
            .flatMap((e) => e.metadata.evidence.map((ev) => ev.id)),
          unsupportedAssumptions: [
            "Application accepts amount or price fields from the client on checkout APIs.",
          ],
        })
      );
    }

    const bypassHypothesis = abuseCases.find((a) => a.category === "workflow_bypass");
    if (bypassHypothesis) {
      observations.push(
        this.observation({
          kind: "checkout_integrity",
          title: "Checkout completion bypass hypothesis",
          detail: bypassHypothesis.description,
          severity: "high",
          confidence: "likely",
          workflowIds: plan.workflowIds,
          invariantIds: [bypassHypothesis.targetInvariantId],
          abuseCaseIds: [bypassHypothesis.id],
          evidenceRefIds: bypassHypothesis.evidence.map((e) => e.id),
          unsupportedAssumptions: bypassHypothesis.assumptions.map((a) => a.statement),
        })
      );
    }

    const settlementWorkflow = context.domain.workflows.find(
      (w) => w.metadata.discoveredWorkflowKind === "payment_webhook_settlement"
    );
    const crossInvariant = invariants.find((i) => i.category === "cross_workflow_consistency");
    if (!settlementWorkflow || !crossInvariant) {
      observations.push(
        this.observation({
          kind: "settlement_dependency",
          title: "Missing or weak settlement dependency",
          detail:
            settlementWorkflow
              ? "Checkout lacks a cross-workflow invariant linking completion to webhook settlement."
              : "No webhook settlement workflow was discovered — checkout may complete without asynchronous settlement evidence.",
          severity: "medium",
          confidence: settlementWorkflow ? "likely" : "possible",
          workflowIds: plan.workflowIds,
          invariantIds: crossInvariant ? [crossInvariant.id] : [],
          abuseCaseIds: abuseCases
            .filter((a) => a.category === "cross_workflow_abuse")
            .map((a) => a.id),
          evidenceRefIds: [],
          unsupportedAssumptions: [
            "Production relies on provider webhooks or async settlement before granting paid value.",
          ],
        })
      );
    }

    return { observations };
  }
}
