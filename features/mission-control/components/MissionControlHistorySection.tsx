"use client";

import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { formatRelativeLocalized } from "@/lib/i18n/format";
import { withAnalysisRunQuery } from "@/features/analysis-runs/lib/build-run-query";

export function MissionControlHistorySection({
  projectId,
  analysisRunId,
  lastReviewAt,
  isVerdictStale = false,
}: {
  projectId: string;
  analysisRunId?: string | null;
  lastReviewAt?: string | null;
  isVerdictStale?: boolean;
}) {
  const { t, locale } = useI18n("missionControl");
  const { t: tc } = useI18n("common");
  const historyHref = withAnalysisRunQuery(`/projects/${projectId}/journey`, analysisRunId);

  const relativeLabels = {
    never: tc("never"),
    justNow: tc("justNow"),
    minutesAgo: tc("minutesAgo"),
    hoursAgo: tc("hoursAgo"),
    daysAgo: tc("daysAgo"),
  };

  const lastReviewLabel = lastReviewAt
    ? formatRelativeLocalized(locale, lastReviewAt, relativeLabels)
    : null;

  return (
    <section className="space-y-3" aria-labelledby="mission-control-history-heading">
      <h2
        id="mission-control-history-heading"
        className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground"
      >
        {t("sections.history")}
      </h2>

      {(lastReviewLabel || isVerdictStale) && (
        <div className="rounded-2xl border border-border/60 bg-[#101014]/40 px-5 py-4 space-y-2 text-sm">
          {lastReviewLabel && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" aria-hidden />
              {t("history.lastReview", { time: lastReviewLabel })}
            </p>
          )}
          {isVerdictStale && (
            <p className="text-brand-warning">{t("history.staleVerdict")}</p>
          )}
        </div>
      )}

      <Link
        href={historyHref}
        aria-label={t("history.openLinkAriaLabel")}
        className="group flex items-center justify-between rounded-2xl border border-border/60 bg-[#101014]/40 px-5 py-4 text-sm transition-colors hover:bg-accent/20"
      >
        <span>{t("sections.historyDescription")}</span>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </section>
  );
}
