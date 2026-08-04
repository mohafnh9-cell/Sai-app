"use client";

import { useMemo } from "react";
import { fixPromptInputFromPriority, findingsByIdMap } from "@/brain/fix-prompt";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { CopySafeFixPromptButton } from "@/features/production-verdict/components/CopySafeFixPromptButton";
import { SafeFixMetrics } from "@/features/production-verdict/components/SafeFixMetrics";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import { AnalyzeProjectButton } from "@/features/projects/components/AnalyzeProjectButton";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

export function ProjectSafeFixHero({
  verdict,
  projectId,
  projectName,
  fixPromptContext,
  reviewContext,
  analysisRunIsolationEnabled = false,
}: {
  verdict: ProductionVerdictV1;
  projectId: string;
  projectName: string;
  fixPromptContext?: FixPromptContext;
  reviewContext: ProjectReviewUiContext;
  analysisRunIsolationEnabled?: boolean;
}) {
  const { t } = useI18n("projects");
  const topPriority = verdict.topPriorities[0] ?? null;

  const fixPromptInput = useMemo(() => {
    if (!topPriority) return null;
    return fixPromptInputFromPriority(topPriority, {
      projectName,
      stack: fixPromptContext?.stack,
      findingsById: fixPromptContext?.findings
        ? findingsByIdMap(fixPromptContext.findings)
        : undefined,
      currentVerdictStatus: verdict.status,
      currentScore: verdict.score,
    });
  }, [fixPromptContext, projectName, topPriority, verdict.score, verdict.status]);

  if (verdict.status === "ready_to_ship" || !topPriority || !fixPromptInput) {
    return (
      <section className="product-section">
        <AnalyzeProjectButton
          projectId={projectId}
          initialContext={reviewContext}
          analysisRunIsolationEnabled={analysisRunIsolationEnabled}
        />
      </section>
    );
  }

  return (
    <section
      className="product-section rounded-3xl border border-primary/25 bg-gradient-to-b from-primary/10 via-[#101014]/80 to-[#101014]/60 p-6 sm:p-8 shadow-[0_0_80px_-24px_rgba(var(--primary-rgb,99,102,241),0.35)]"
      aria-labelledby="project-safe-fix-heading"
    >
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary mb-2">
        {t("safeFixHeroEyebrow")}
      </p>
      <h2 id="project-safe-fix-heading" className="text-sm uppercase tracking-[0.18em] text-muted-foreground">
        {t("fixThisFirst")}
      </h2>
      <p className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight leading-snug">
        {topPriority.title}
      </p>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-2xl">
        {topPriority.reason}
      </p>

      <div className="mt-6 border-t border-border/50 pt-6">
        <SafeFixMetrics input={fixPromptInput} />
      </div>

      <ol className="mt-8 space-y-4">
        <li className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-border/60 bg-secondary/20 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("safeFixStep1Label")}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{t("safeFixStep1Body")}</p>
          </div>
          <CopySafeFixPromptButton
            input={fixPromptInput}
            source="priority"
            priorityId={topPriority.id}
            size="default"
            variant="default"
            className="w-full sm:w-auto h-11 px-6 text-base shrink-0"
            label={t("copySafeFix")}
            copiedLabel={t("copiedSafeFix")}
          />
        </li>
        <li className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-border/60 bg-secondary/20 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("safeFixStep2Label")}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{t("safeFixStep2Body")}</p>
          </div>
          <Button
            variant="outline"
            className="w-full sm:w-auto h-11 px-6 text-base shrink-0"
            onClick={() => window.open("cursor://", "_self")}
          >
            {t("openCursor")}
          </Button>
        </li>
        <li className="rounded-2xl border border-border/60 bg-secondary/20 p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("safeFixStep3Label")}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{t("safeFixStep3Body")}</p>
          </div>
          <AnalyzeProjectButton
          projectId={projectId}
          initialContext={reviewContext}
          analysisRunIsolationEnabled={analysisRunIsolationEnabled}
        />
        </li>
      </ol>
    </section>
  );
}
