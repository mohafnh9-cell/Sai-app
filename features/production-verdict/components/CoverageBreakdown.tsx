"use client";

import { useState } from "react";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { trackEvent } from "@/lib/analytics/track";
import { useI18n } from "@/lib/i18n/client";

export function CoverageBreakdown({ verdict }: { verdict: ProductionVerdictV1 }) {
  const { t } = useI18n("technicalDetails");
  const [methodologyOpen, setMethodologyOpen] = useState(false);

  const groups = [
    { title: t("evaluated"), areas: verdict.evaluatedAreas, tone: "text-success" },
    {
      title: t("partiallyEvaluated"),
      areas: verdict.partiallyEvaluatedAreas,
      tone: "text-warning",
    },
    {
      title: t("notEvaluated"),
      areas: verdict.unevaluatedAreas,
      tone: "text-muted-foreground",
    },
  ].filter((group) => group.areas.length > 0);

  return (
    <section
      className="rounded-xl border border-border/60 bg-surface/50 p-5"
      aria-labelledby="coverage-heading"
    >
      <h2 id="coverage-heading" className="text-sm font-medium">
        {t("whatEvaluated")}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("filesAnalyzed", { count: verdict.filesAnalyzed })}
        {verdict.coverageRatio != null
          ? ` · ${t("repoCoverage", { percent: Math.round(verdict.coverageRatio * 100) })}`
          : ""}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {groups.map((group) => (
          <div key={group.title}>
            <p className={`text-xs font-medium uppercase tracking-wide ${group.tone}`}>
              {group.title}
            </p>
            <ul className="mt-2 space-y-1">
              {group.areas.map((area) => (
                <li key={area.key} className="text-sm text-muted-foreground">
                  <span className="text-foreground">{area.label}</span>
                  {area.score != null ? ` · ${area.score}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <details
        className="mt-4"
        open={methodologyOpen}
        onToggle={(event) => {
          const open = (event.target as HTMLDetailsElement).open;
          setMethodologyOpen(open);
          if (open) trackEvent("coverage_methodology_opened");
        }}
      >
        <summary className="cursor-pointer text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
          {t("scoreMethodology")}
        </summary>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {verdict.methodologyNote}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{t("scoreDisclaimer")}</p>
      </details>
    </section>
  );
}
