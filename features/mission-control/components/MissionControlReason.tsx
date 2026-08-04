"use client";

import { Loader2 } from "lucide-react";
import { verdictExperienceFromVerdict } from "@/brain/production-verdict/experience-view";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { SecurityTestPhase } from "@/features/security-testing/types";
import { useI18n } from "@/lib/i18n/client";
import { verdictStatusMessage } from "@/lib/i18n/verdict-copy";

export function MissionControlReason({
  verdict,
  displayPhase,
  reviewInProgress,
}: {
  verdict: ProductionVerdictV1;
  displayPhase: SecurityTestPhase;
  reviewInProgress: boolean;
}) {
  const { t } = useI18n();
  const { t: tm } = useI18n("missionControl");
  const translate = (key: string, params?: Record<string, string | number | null | undefined>) =>
    t(key, params);

  const view = verdictExperienceFromVerdict(verdict, {
    statusMessage: verdictStatusMessage(verdict.status, translate),
  });

  const topBlocker = verdict.topPriorities[0] ?? null;

  if (reviewInProgress || displayPhase === "preparing") {
    return (
      <section className="space-y-2" aria-labelledby="mission-control-reason-heading">
        <h2 id="mission-control-reason-heading" className="text-sm font-medium text-muted-foreground">
          {tm("sections.reason")}
        </h2>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" aria-hidden />
          <p>{tm("sections.reviewInProgress")}</p>
        </div>
      </section>
    );
  }

  if (displayPhase === "running") {
    return (
      <section className="space-y-2" aria-labelledby="mission-control-reason-heading">
        <h2 id="mission-control-reason-heading" className="text-sm font-medium text-muted-foreground">
          {tm("sections.reason")}
        </h2>
        <p className="text-base leading-relaxed">{tm("sections.securityTestRunning")}</p>
      </section>
    );
  }

  const reasonText =
    view.status !== "ready_to_ship" && topBlocker?.reason
      ? topBlocker.reason
      : view.executiveSummary || view.statusMessage;

  return (
    <section className="space-y-2" aria-labelledby="mission-control-reason-heading">
      <h2 id="mission-control-reason-heading" className="text-sm font-medium text-muted-foreground">
        {tm("sections.reason")}
      </h2>
      <p className="text-base leading-relaxed text-foreground/90">{reasonText}</p>
    </section>
  );
}
