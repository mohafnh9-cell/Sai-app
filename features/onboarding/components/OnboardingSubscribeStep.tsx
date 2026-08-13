"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import {
  BuilderPlanFeatures,
  BuilderPlanPrice,
  StripeCheckoutButton,
} from "@/features/billing/components/StripeCheckoutButton";

export function OnboardingSubscribeStep({
  onSubscribed,
  onBack,
}: {
  onSubscribed: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n("onboarding");
  const router = useRouter();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="space-y-2 text-center sm:text-left">
        <h2 className="text-2xl font-semibold tracking-tight">{t("subscribeTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("subscribeBody")}</p>
      </div>

      <div className="rounded-xl border border-border/60 bg-secondary/20 p-6 space-y-4">
        <div>
          <p className="text-sm font-medium">{t("subscribePlanName")}</p>
          <BuilderPlanPrice />
        </div>
        <BuilderPlanFeatures />
        <StripeCheckoutButton
          label={t("subscribeCta")}
          className="w-full h-12 text-base"
          onAlreadySubscribed={() => {
            onSubscribed();
            router.refresh();
          }}
        />
      </div>

      <Button variant="ghost" className="w-full" onClick={onBack}>
        {t("subscribeBack")}
      </Button>
    </div>
  );
}
