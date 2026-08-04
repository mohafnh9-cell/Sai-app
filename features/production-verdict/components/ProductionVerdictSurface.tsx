"use client";

import Link from "next/link";
import { Check, AlertTriangle } from "lucide-react";
import { verdictExperienceFromVerdict } from "@/brain/production-verdict/experience-view";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { shouldShowScore, verdictToneClass } from "@/brain/production-verdict/status-ui";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { ProductionVerdictHero } from "@/features/production-verdict/components/ProductionVerdictHero";
import { useI18n } from "@/lib/i18n/client";
import { verdictStatusMessage } from "@/lib/i18n/verdict-copy";

export type ProductionVerdictSurfaceVariant = "guided" | "default" | "product";

export function ProductionVerdictSurface({
  verdict,
  variant = "guided",
  reportHref,
  retryHref,
}: {
  verdict: ProductionVerdictV1;
  variant?: ProductionVerdictSurfaceVariant;
  reportHref?: string;
  retryHref?: string;
}) {
  const { t } = useI18n();
  const translate = (key: string, params?: Record<string, string | number | null | undefined>) =>
    t(key, params);

  const view = verdictExperienceFromVerdict(verdict, {
    statusMessage: verdictStatusMessage(verdict.status, translate),
  });

  if (variant === "default" || variant === "product") {
    return (
      <ProductionVerdictHero
        verdict={verdict}
        view={view}
        variant={variant === "product" ? "product" : "default"}
        reportHref={reportHref}
        retryHref={retryHref}
      />
    );
  }

  const tone = verdictToneClass(view.status);
  const areas = [...verdict.evaluatedAreas, ...verdict.partiallyEvaluatedAreas].slice(0, 5);
  const showScore = shouldShowScore(view.score, view.status);

  return (
    <section
      className={`rounded-3xl border p-8 sm:p-10 surface-premium ${tone}`}
      aria-labelledby="production-verdict-surface-heading"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
        {t("verdict.productionVerdict")}
      </p>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-4">
          {showScore && view.score != null ? (
            <div className="flex items-baseline gap-3">
              <p className="text-6xl sm:text-7xl font-semibold tabular-nums tracking-tighter">
                {view.score}
              </p>
              <span className="text-2xl text-muted-foreground font-medium">/ 100</span>
            </div>
          ) : null}
          <h2
            id="production-verdict-surface-heading"
            className="text-xl sm:text-2xl font-semibold tracking-tight max-w-xl"
          >
            {view.statusMessage}
          </h2>
          <VerdictStatusBadge status={view.status} />
          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            {view.executiveSummary}
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

      {reportHref ? (
        <div className="mt-6">
          <Link
            href={reportHref}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t("verdict.viewTechnicalReport")}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
