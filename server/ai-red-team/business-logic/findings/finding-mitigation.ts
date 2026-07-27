import type { BusinessInvariant } from "../invariants/invariant.types";
import type { BusinessAbuseCase } from "../abuse/abuse.types";
import type { BusinessLogicFindingMitigation, BusinessLogicFindingRecommendation } from "./finding.types";

export function buildMitigation(input: {
  invariant: BusinessInvariant;
  abuseCase: BusinessAbuseCase | null;
}): BusinessLogicFindingMitigation {
  const recommendations: BusinessLogicFindingRecommendation[] = [];
  const { invariant, abuseCase } = input;

  recommendations.push({
    id: `rec-invariant-${invariant.invariantKey}`,
    kind: "restore_invariant",
    statement: `Restore and enforce invariant: ${invariant.title}`,
  });

  if (invariant.supportingTransitionIds.length > 0) {
    recommendations.push({
      id: `rec-transition-${invariant.invariantKey}`,
      kind: "validate_transition",
      statement: `Validate transitions ${invariant.supportingTransitionIds.join(", ")} before granting business value.`,
    });
  }

  switch (invariant.category) {
    case "ordering":
    case "payment_lifecycle":
      recommendations.push({
        id: `rec-order-${invariant.invariantKey}`,
        kind: "ordering_rule",
        statement:
          "Enforce strict ordering: settlement and confirmation must precede fulfillment or entitlement grant.",
      });
      break;
    case "ownership":
    case "membership_lifecycle":
      recommendations.push({
        id: `rec-own-${invariant.invariantKey}`,
        kind: "ownership_rule",
        statement: "Bind resource mutations to the authenticated tenant or owner scope.",
      });
      break;
    case "idempotency":
    case "retry_safety":
      recommendations.push({
        id: `rec-idem-${invariant.invariantKey}`,
        kind: "idempotency",
        statement: "Use idempotency keys and deduplication for retried or replayed business operations.",
      });
      break;
    case "concurrency":
      recommendations.push({
        id: `rec-conc-${invariant.invariantKey}`,
        kind: "concurrency",
        statement:
          "Serialize or lock concurrent transitions that affect the same economic or entitlement state.",
      });
      break;
    default:
      break;
  }

  return {
    summary: invariant.potentialImpact,
    recommendations,
    hintsFromAbuse: abuseCase?.mitigationHints ?? [],
  };
}
