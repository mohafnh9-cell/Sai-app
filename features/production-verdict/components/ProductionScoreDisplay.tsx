"use client";

import { shouldShowScore, displayScore } from "@/brain/production-verdict/status-ui";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { useI18n } from "@/lib/i18n/client";

export function ProductionScoreDisplay({
  score,
  status,
  size = "lg",
  className,
}: {
  score: number | null;
  status: VerdictStatus;
  size?: "sm" | "lg" | "xl";
  className?: string;
}) {
  const { t } = useI18n("verdict");
  const show = shouldShowScore(score, status);
  const sizeClass =
    size === "xl" ? "text-6xl" : size === "lg" ? "text-5xl" : "text-2xl";

  return (
    <div className={className} aria-label={t("productionReadyScore")}>
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-1">
        {t("productionReadyScore")}
      </p>
      {show ? (
        <p className={`${sizeClass} font-semibold tabular-nums tracking-tight`}>
          {displayScore(score)}
          <span className="ml-1 text-lg font-normal text-muted-foreground">/ 100</span>
        </p>
      ) : (
        <p className="text-lg font-medium text-muted-foreground">
          {t("status.insufficient_data.label")}
        </p>
      )}
    </div>
  );
}
