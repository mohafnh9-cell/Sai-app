"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { appendAnalysisRunSearchParams } from "@/features/analysis-runs/lib/build-run-query";

export function OnboardingDashboardEntry({
  projectId,
  scanId,
}: {
  projectId?: string | null;
  scanId?: string | null;
}) {
  const router = useRouter();
  const { t } = useI18n("onboarding");

  const finish = () => {
    if (projectId) {
      const params = new URLSearchParams({ onboarded: "1" });
      appendAnalysisRunSearchParams(params, scanId);
      router.push(`/projects/${projectId}/mission-control?${params.toString()}`);
      return;
    }
    router.push("/dashboard?firstVerdict=1");
  };

  return (
    <div className="space-y-8 text-center animate-in fade-in zoom-in-95 duration-700">
      <div className="rounded-3xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/10 to-transparent p-10">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 mb-6">
          <Rocket className="h-8 w-8 text-emerald-400" aria-hidden />
        </div>
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-emerald-400/90">
            {t("dashboardEyebrow")}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">{t("dashboardReadyTitle")}</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            {t("dashboardReadyBody")}
          </p>
        </div>
      </div>
      <Button size="lg" className="w-full h-12 text-base" onClick={finish}>
        {projectId ? t("openProject") : t("goToDashboard")}
        <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
