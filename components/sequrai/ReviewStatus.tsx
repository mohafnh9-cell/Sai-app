"use client";

import { ScanStatusIndicator, type ScanPhase } from "./ScanStatusIndicator";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type ReviewPhase = ScanPhase | "analyzing" | "verifying";

type ReviewStatusProps = {
  phase: ReviewPhase;
  progress?: number | null;
  message?: string | null;
  className?: string;
};

function mapPhase(phase: ReviewPhase): ScanPhase {
  if (phase === "analyzing" || phase === "verifying") return "running";
  return phase;
}

export function ReviewStatus({ phase, progress, message, className }: ReviewStatusProps) {
  const { t } = useI18n("missionControl");

  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-label-caps">{t(`reviewPhase.${phase}` as "reviewPhase.idle")}</p>
      <ScanStatusIndicator phase={mapPhase(phase)} progress={progress} message={message ?? undefined} />
    </div>
  );
}
