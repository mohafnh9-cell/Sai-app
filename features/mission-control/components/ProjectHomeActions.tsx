"use client";

import Link from "next/link";
import { ScanSearch, Shield, Sparkles } from "lucide-react";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { AnalyzeProjectButton } from "@/features/projects/components/AnalyzeProjectButton";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { withAnalysisRunQuery } from "@/features/analysis-runs/lib/build-run-query";
import { useI18n } from "@/lib/i18n/client";
import { formatRelativeLocalized } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import { shouldShowScore } from "@/brain/production-verdict/status-ui";

function ActionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-border/60 bg-card/40 p-5 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="space-y-1 min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      {children}
    </article>
  );
}

export function ProjectHomeActions({
  projectId,
  reviewContext,
  verdict,
  analysisRunId,
  attackCenterEnabled,
  attackCenterHref,
  analysisRunIsolationEnabled = false,
  reviewInProgress = false,
}: {
  projectId: string;
  reviewContext: ProjectReviewUiContext | null;
  verdict: ProductionVerdictV1 | null;
  analysisRunId?: string | null;
  attackCenterEnabled: boolean;
  attackCenterHref?: string | null;
  analysisRunIsolationEnabled?: boolean;
  reviewInProgress?: boolean;
}) {
  const { t, locale } = useI18n("missionControl");
  const { t: tc } = useI18n("common");

  const securityHref =
    attackCenterHref ??
    withAnalysisRunQuery(`/projects/${projectId}/attack-center`, analysisRunId ?? null);

  const relativeLabels = {
    never: tc("never"),
    justNow: tc("justNow"),
    minutesAgo: tc("minutesAgo"),
    hoursAgo: tc("hoursAgo"),
    daysAgo: tc("daysAgo"),
  };

  const lastAnalysisLabel = verdict?.generatedAt
    ? formatRelativeLocalized(locale, verdict.generatedAt, relativeLabels)
    : t("projectHome.lastAnalysisNever");

  const topBlocker = verdict?.topPriorities?.[0] ?? null;
  const showScore = verdict ? shouldShowScore(verdict.score, verdict.status) : false;

  return (
    <section className="space-y-6 mb-10" aria-labelledby="project-home-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p id="project-home-heading" className="text-muted-foreground">
          {reviewContext?.githubConnected
            ? t("projectHome.repositoryConnected")
            : t("projectHome.repositoryNotConnected")}
        </p>
        <p className="text-muted-foreground">
          {t("projectHome.lastAnalysis")}:{" "}
          <span className="text-foreground font-medium">{lastAnalysisLabel}</span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ActionCard
          icon={<ScanSearch className="h-5 w-5" aria-hidden />}
          title={t("projectHome.scanCode.title")}
          description={t("projectHome.scanCode.description")}
        >
          {reviewContext ? (
            <AnalyzeProjectButton
              projectId={projectId}
              initialContext={reviewContext}
              analysisRunIsolationEnabled={analysisRunIsolationEnabled}
              size="default"
              className="w-full h-11 rounded-full"
              labelOverride={t("projectHome.scanCode.cta")}
            />
          ) : (
            <Button className="w-full h-11 rounded-full" disabled>
              {t("projectHome.scanCode.cta")}
            </Button>
          )}
        </ActionCard>

        {attackCenterEnabled ? (
          <ActionCard
            icon={<Shield className="h-5 w-5" aria-hidden />}
            title={t("projectHome.testSecurity.title")}
            description={t("projectHome.testSecurity.description")}
          >
            <Button asChild className="w-full h-11 rounded-full" variant="secondary">
              <Link href={securityHref}>{t("projectHome.testSecurity.cta")}</Link>
            </Button>
          </ActionCard>
        ) : null}
      </div>

      {verdict ? (
        <article
          id="production-verdict"
          className="rounded-2xl border border-border/60 bg-[#101014]/50 p-6 sm:p-8 space-y-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {t("projectHome.verdictSummary.title")}
              </p>
              <div className="flex items-end gap-4">
                {showScore && verdict.score != null ? (
                  <p className="text-5xl font-semibold tabular-nums tracking-tight leading-none">
                    {verdict.score}
                  </p>
                ) : null}
                <VerdictStatusBadge status={verdict.status} />
              </div>
              {showScore ? (
                <p className="text-xs text-muted-foreground">{t("projectHome.verdictSummary.score")}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">
              {t("projectHome.verdictSummary.mainBlocker")}
            </p>
            <p className="text-base font-medium leading-snug">
              {topBlocker?.title ?? t("projectHome.verdictSummary.noBlocker")}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline" className="rounded-full">
              <a href="#production-verdict-detail">{t("projectHome.verdictSummary.viewVerdict")}</a>
            </Button>
            {verdict.status === "ready_to_ship" && reviewContext ? (
              <AnalyzeProjectButton
                projectId={projectId}
                initialContext={reviewContext}
                analysisRunIsolationEnabled={analysisRunIsolationEnabled}
                size="default"
                className="rounded-full"
                labelOverride={t("projectHome.verdictSummary.scanAgain")}
              />
            ) : null}
          </div>
        </article>
      ) : null}

      {verdict && topBlocker && verdict.status !== "ready_to_ship" ? (
        <ActionCard
          icon={<Sparkles className="h-5 w-5" aria-hidden />}
          title={t("projectHome.aiFix.title")}
          description={t("projectHome.aiFix.description")}
        >
          <Button asChild className="w-full h-11 rounded-full sm:w-auto sm:min-w-[220px]">
            <a href="#production-verdict-detail">{t("projectHome.aiFix.cta")}</a>
          </Button>
        </ActionCard>
      ) : null}
    </section>
  );
}
