"use client";

import { Button } from "@/components/ui/button";
import { OrgSetupForm } from "@/features/organizations/components/OrgSetupForm";
import { useI18n } from "@/lib/i18n/client";

export function OnboardingWelcomeStep({
  hasOrg,
  onContinue,
}: {
  hasOrg: boolean;
  onContinue: () => void;
}) {
  const { t } = useI18n("onboarding");
  const { t: tc } = useI18n("common");

  if (!hasOrg) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="space-y-2 text-center sm:text-left">
          <h2 className="text-2xl font-semibold tracking-tight">{t("welcomeHeadline")}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{t("welcomeSub")}</p>
        </div>
        <OrgSetupForm nextStep="subscribe" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="space-y-2 text-center sm:text-left">
        <h2 className="text-2xl font-semibold tracking-tight">{t("welcomeHeadline")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("welcomeSub")}</p>
      </div>
      <Button className="w-full h-12 text-base" size="lg" onClick={onContinue}>
        {tc("continue")}
      </Button>
    </div>
  );
}
