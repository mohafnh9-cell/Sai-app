"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

const STEPS = [
  { key: "repository" },
  { key: "analysis" },
  { key: "security" },
  { key: "verification" },
  { key: "verdict" },
] as const;

type ProductionJourneyStripProps = {
  activeStep?: (typeof STEPS)[number]["key"];
  className?: string;
};

/** Compact production journey — orientation, not a workflow engine. */
export function ProductionJourneyStrip({
  activeStep = "verdict",
  className,
}: ProductionJourneyStripProps) {
  const { t } = useI18n("productionJourney");
  const activeIndex = STEPS.findIndex((s) => s.key === activeStep);

  return (
    <nav className={cn("overflow-x-auto", className)} aria-label={t("title")}>
      <ol className="flex items-center gap-1 min-w-max text-xs text-muted-foreground">
        {STEPS.map((step, index) => {
          const active = index <= activeIndex;
          const current = step.key === activeStep;
          return (
            <li key={step.key} className="flex items-center gap-1">
              {index > 0 ? <span className="opacity-40 px-0.5" aria-hidden>→</span> : null}
              <span
                className={cn(
                  "px-2 py-1 rounded-md seq-transition",
                  current && "bg-accent/50 text-foreground font-medium",
                  active && !current && "text-foreground/80"
                )}
              >
                {t(`steps.${step.key}`)}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
