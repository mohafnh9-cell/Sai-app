"use client";

import { verdictExperienceFromVerdict } from "@/brain/production-verdict/experience-view";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { verdictToneClass } from "@/brain/production-verdict/status-ui";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { useI18n } from "@/lib/i18n/client";
import { Check, AlertTriangle } from "lucide-react";

export function ProductionReadinessHero({ verdict }: { verdict: ProductionVerdictV1 }) {
  const { t } = useI18n("readiness");
  const view = verdictExperienceFromVerdict(verdict);
  const tone = verdictToneClass(view.status);

  const areas = [
    ...verdict.evaluatedAreas,
    ...verdict.partiallyEvaluatedAreas,
  ].slice(0, 5);

  return (
    <section
      className={`rounded-3xl border p-8 sm:p-10 surface-premium ${tone}`}
      aria-labelledby="production-readiness-heading"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
        {t("verdict.eyebrow")}
      </p>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-4">
          {view.showScore && view.score != null ? (
            <div className="flex items-baseline gap-3">
              <p className="text-6xl sm:text-7xl font-semibold tabular-nums tracking-tighter">
                {view.score}
              </p>
              <span className="text-2xl text-muted-foreground font-medium">/ 100</span>
            </div>
          ) : null}
          <h2
            id="production-readiness-heading"
            className="text-xl sm:text-2xl font-semibold tracking-tight max-w-xl"
          >
            {view.statusMessage}
          </h2>
          <VerdictStatusBadge status={view.status} />
          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            {verdict.summary || view.executiveSummary}
          </p>
        </div>
      </div>

      {areas.length > 0 ? (
        <ul className="mt-8 grid gap-2 sm:grid-cols-2 border-t border-border/50 pt-6">
          {areas.map((area) => {
            const ok = area.status === "evaluated" && (area.score == null || area.score >= 70);
            const partial = area.status === "partial";
            return (
              <li key={area.key} className="flex items-center gap-2 text-sm">
                {ok ? (
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" aria-hidden />
                )}
                <span className={partial ? "text-muted-foreground" : undefined}>{area.label}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
