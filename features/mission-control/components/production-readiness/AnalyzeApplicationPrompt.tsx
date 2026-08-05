"use client";

import { Loader2 } from "lucide-react";
import { AnalyzeProjectScanContainer } from "@/features/projects/components/AnalyzeProjectScanContainer";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { useI18n } from "@/lib/i18n/client";

export function AnalyzeApplicationPrompt({
  projectId,
  reviewContext,
  preparing = false,
  waitMessage,
  analysisRunIsolationEnabled = false,
}: {
  projectId: string;
  reviewContext: ProjectReviewUiContext;
  preparing?: boolean;
  waitMessage?: string | null;
  analysisRunIsolationEnabled?: boolean;
}) {
  const { t } = useI18n("readiness");

  return (
    <section
      className="rounded-3xl border border-border/60 bg-gradient-to-b from-primary/5 to-transparent px-8 py-16 sm:py-20 text-center space-y-8"
      aria-labelledby="analyze-application-heading"
      aria-busy={preparing}
    >
      <div className="mx-auto max-w-lg space-y-4">
        <h1
          id="analyze-application-heading"
          className="text-[clamp(1.75rem,5vw,2.5rem)] font-semibold tracking-tight leading-tight"
        >
          {preparing ? t("analyze.preparingHeadline") : t("analyze.headline")}
        </h1>
        {!preparing ? (
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            {t("analyze.description")}
          </p>
        ) : null}
      </div>

      {preparing && waitMessage ? (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" aria-hidden />
          <span>{waitMessage}</span>
        </div>
      ) : null}

      <div className="flex justify-center">
        {preparing ? (
          <div className="inline-flex h-12 min-w-[220px] items-center justify-center rounded-full border border-border bg-muted/30 px-8 text-sm font-medium text-muted-foreground">
            {t("analyze.preparingCta")}
          </div>
        ) : (
          <AnalyzeProjectScanContainer
            projectId={projectId}
            initialContext={reviewContext}
            showCommitHint
            size="default"
            className="h-12 min-w-[240px] rounded-full text-base px-8"
            labelOverride={t("analyze.cta")}
            analysisRunIsolationEnabled={analysisRunIsolationEnabled}
          />
        )}
      </div>
    </section>
  );
}
