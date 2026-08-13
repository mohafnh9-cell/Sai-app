"use client";

import Link from "next/link";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StripeCheckoutButton } from "@/features/billing/components/StripeCheckoutButton";
import { useI18n } from "@/lib/i18n/client";

export function ScanPaywallBanner({
  message,
  returnPath,
}: {
  message?: string;
  returnPath?: string;
}) {
  const { t } = useI18n("billing");

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-sm">
        <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="font-medium">{t("scanPaywallTitle")}</p>
          <p className="text-muted-foreground">{message ?? t("scanPaywallBody")}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:items-end">
        <StripeCheckoutButton label={t("subscribeCta")} className="shrink-0" returnTo={returnPath} />
        <Button variant="link" size="sm" className="h-auto px-0" asChild>
          <Link href={returnPath ? `/billing?returnTo=${encodeURIComponent(returnPath)}` : "/billing"}>
            {t("scanPaywallBillingLink")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
