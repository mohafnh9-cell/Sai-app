"use client";

import { useI18n } from "@/lib/i18n/client";
import { StripeCheckoutButton } from "@/features/billing/components/StripeCheckoutButton";
import { StripePortalButton } from "@/features/billing/components/StripePortalButton";

export function BillingActions({ isActive }: { isActive: boolean }) {
  const { t } = useI18n("billing");

  if (isActive) {
    return (
      <StripePortalButton label={t("manageSubscription")} className="w-full" variant="outline" />
    );
  }

  return (
    <StripeCheckoutButton label={t("subscribeCta")} className="w-full" variant="default" />
  );
}
