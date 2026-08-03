"use client";

import Link from "next/link";
import { Award, GitCommit, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VerdictExperienceView } from "@/brain/production-verdict/experience-view";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { ProductionScoreDisplay } from "./ProductionScoreDisplay";
import { trackEvent } from "@/lib/analytics/track";
import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/client";
import { formatLocalizedDate } from "@/lib/i18n/format";

export function ReadyToShipMoment({
  view,
  verdict,
  reportHref,
}: {
  view: VerdictExperienceView;
  verdict: ProductionVerdictV1;
  reportHref?: string;
}) {
  const { t, locale } = useI18n("verdict");

  useEffect(() => {
    trackEvent("ready_to_ship_reached", {
      projectId: verdict.projectId,
      scanId: verdict.scanId,
    });
  }, [verdict.projectId, verdict.scanId]);

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-[#64D98B]/30 bg-gradient-to-br from-[#64D98B]/10 via-[#101014] to-[#101014] p-8 md:p-10"
      aria-labelledby="ready-to-ship-heading"
    >
      <div className="absolute top-4 right-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#64D98B]/20 px-3 py-1 text-xs font-medium text-[#64D98B]">
          <Award className="h-3.5 w-3.5" aria-hidden />
          {t("readyMoment.badge")}
        </span>
      </div>

      <div className="space-y-6 max-w-2xl">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#64D98B]">
            {t("productionVerdict")}
          </p>
          <h2 id="ready-to-ship-heading" className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight">
            {t(`status.${view.status}.message`)}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t("readyMoment.disclaimer")}</p>
        </div>

        <div className="flex flex-wrap gap-6 items-end">
          <ProductionScoreDisplay score={view.score} status={view.status} size="xl" />
          <div className="space-y-3 text-sm">
            {view.commitSha && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <GitCommit className="h-4 w-4" aria-hidden />
                {t("readyMoment.reviewedCommit")}{" "}
                <code className="text-foreground">{view.commitSha.slice(0, 12)}</code>
              </p>
            )}
            <p className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" aria-hidden />
              {formatLocalizedDate(locale, view.generatedAt)}
            </p>
            {view.resolvedBlockers > 0 && (
              <p className="text-[#64D98B]">
                {t("readyMoment.blockersResolved", { count: view.resolvedBlockers })}
              </p>
            )}
            <p className="text-muted-foreground">
              {t("readyMoment.areasEvaluated", { count: view.evaluatedAreaCount })}
            </p>
          </div>
        </div>

        {reportHref && (
          <Button variant="outline" size="sm" asChild>
            <Link href={reportHref}>{t("viewTechnicalReport")}</Link>
          </Button>
        )}
      </div>
    </section>
  );
}
