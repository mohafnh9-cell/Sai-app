"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { VerdictExperienceView } from "@/brain/production-verdict/experience-view";
import { useI18n } from "@/lib/i18n/client";

export function ScoreDeltaSummary({ view }: { view: VerdictExperienceView }) {
  const { t } = useI18n("verdict");

  if (view.scoreDelta == null && !view.deltaNarrative) return null;

  const delta = view.scoreDelta ?? 0;
  const tone =
    view.deltaDirection === "up"
      ? "text-emerald-400"
      : view.deltaDirection === "down"
        ? "text-red-400"
        : "text-muted-foreground";

  const deltaLabel =
    delta > 0 ? `+${delta}` : String(delta);

  return (
    <section
      className="rounded-xl border border-border/60 bg-[#101014]/80 p-4"
      aria-label={t("scoreDelta")}
    >
      <div className="flex flex-wrap items-start gap-3">
        {view.scoreDelta != null && view.scoreDelta !== 0 && (
          <p className={`flex items-center gap-1 text-sm font-medium ${tone}`}>
            {delta > 0 ? (
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            ) : (
              <ArrowDownRight className="h-4 w-4" aria-hidden />
            )}
            {t("scoreChangeSinceReview", { delta: deltaLabel })}
          </p>
        )}
        {view.scoreDelta === 0 && (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Minus className="h-4 w-4" aria-hidden />
            {t("noScoreChangeSinceReview")}
          </p>
        )}
      </div>
      {view.deltaNarrative && (
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{view.deltaNarrative}</p>
      )}
    </section>
  );
}
