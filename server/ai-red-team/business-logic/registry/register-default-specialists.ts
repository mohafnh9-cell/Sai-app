import type { BusinessLogicSpecialist } from "../specialists/specialist.types";
import { CheckoutIntegritySpecialist } from "../specialists/checkout-integrity-specialist";
import { WebhookSettlementSpecialist } from "../specialists/webhook-settlement-specialist";
import { SubscriptionLifecycleSpecialist } from "../specialists/subscription-lifecycle-specialist";
import { PromotionIntegritySpecialist } from "../specialists/promotion-integrity-specialist";
import { InvitationMembershipSpecialist } from "../specialists/invitation-membership-specialist";

/** RT9 Specialist Pack V1 — register new specialists here without changing the coordinator loop. */
export function createDefaultBusinessLogicSpecialists(): BusinessLogicSpecialist[] {
  return [
    new CheckoutIntegritySpecialist(),
    new WebhookSettlementSpecialist(),
    new SubscriptionLifecycleSpecialist(),
    new PromotionIntegritySpecialist(),
    new InvitationMembershipSpecialist(),
  ];
}
