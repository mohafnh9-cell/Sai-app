"use client";

import type { AreaProgress } from "@/brain/production-journey/schema";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type RepositoryHealthProps = {
  areas: AreaProgress[];
  className?: string;
};

/** Repository health dimensions — only renders evaluated areas with real scores. */
export function RepositoryHealth({ areas, className }: RepositoryHealthProps) {
  const { t } = useI18n("missionControl");
  const evaluated = areas.filter(
    (area) => area.status === "evaluated" && area.currentScore != null
  );

  if (evaluated.length === 0) return null;

  return (
    <section className={cn("space-y-4", className)} aria-labelledby="repository-health-heading">
      <div>
        <h2 id="repository-health-heading" className="text-sm font-semibold tracking-tight">
          {t("repositoryHealth.title")}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t("repositoryHealth.subtitle")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {evaluated.map((area) => (
          <div
            key={area.key}
            className="flex items-center justify-between gap-4 border-b border-border/40 pb-3 last:border-0"
          >
            <span className="text-sm text-muted-foreground">{area.label}</span>
            <span className="text-lg font-semibold tabular-nums">{area.currentScore}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
