"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CopySafeFixPromptButton } from "@/features/production-verdict/components/CopySafeFixPromptButton";
import { fixPromptInputFromPriority } from "@/brain/fix-prompt";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { MissionObjectiveState } from "../types";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import { useI18n } from "@/lib/i18n/client";

export function CurrentObjective({
  objective,
  projectId,
  verdict,
  fixPromptContext,
}: {
  objective: MissionObjectiveState;
  projectId: string;
  verdict: ProductionVerdictV1 | null;
  fixPromptContext?: FixPromptContext;
}) {
  const { t } = useI18n("missionControl");
  const top = verdict?.topPriorities[0];
  const fixInput =
    top && fixPromptContext
      ? fixPromptInputFromPriority(top, {
          projectName: fixPromptContext.projectName,
          stack: fixPromptContext.stack,
          currentVerdictStatus: fixPromptContext.currentVerdictStatus,
          currentScore: fixPromptContext.currentScore,
        })
      : null;

  const engineeringPlanLabel =
    objective.engineeringPlanStatus === "ready"
      ? t("objective.engineeringPlanReady")
      : t("objective.engineeringPlanPending");
  const replayLabel =
    objective.replayStatus === "passed" ? t("objective.replayPassed") : t("objective.replayPending");

  const primaryButtonLabel =
    objective.primaryAction === "analyze"
      ? t("objective.startAnalysis")
      : t("objective.generateFix");

  return (
    <section
      className="rounded-3xl border border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-8 space-y-6"
      aria-labelledby="current-objective-heading"
    >
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-primary mb-2">{t("objective.title")}</p>
        <h2 id="current-objective-heading" className="text-xl font-semibold tracking-tight">
          {objective.title}
        </h2>
      </div>
      <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
        <span>
          {t("objective.estimatedEffort")} {objective.estimatedEffortLabel}
        </span>
        <span>{engineeringPlanLabel}</span>
        <span>{replayLabel}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {fixInput && objective.primaryAction === "generate_fix" ? (
          <CopySafeFixPromptButton
            input={fixInput}
            source="priority"
            priorityId={top?.id}
            label={t("objective.generateFix")}
          />
        ) : (
          <Button asChild>
            <Link href={`/projects/${projectId}`}>{primaryButtonLabel}</Link>
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href={`/projects/${projectId}`}>{t("objective.viewDetails")}</Link>
        </Button>
      </div>
    </section>
  );
}
