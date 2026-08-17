"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { ProductionIntelligence } from "@/brain/production-intelligence/schema";
import { Button } from "@/components/ui/button";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { WhatChangedSection } from "@/components/sequrai/WhatChangedSection";
import { RecommendedAction } from "@/components/sequrai/RecommendedAction";
import { useI18n } from "@/lib/i18n/client";
import { useDemoNavigation } from "@/features/demo/use-demo-navigation";
import { trackEvent } from "@/lib/analytics/track";
import type { ProductionPriority } from "@/brain/production-verdict/schema";
import { fixPromptInputFromPriority } from "@/brain/fix-prompt";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import { CopySafeFixPromptButton } from "@/features/production-verdict/components/CopySafeFixPromptButton";

function MomentumIcon({ momentum }: { momentum: ProductionIntelligence["momentum"] }) {
  if (momentum === "improving") {
    return <TrendingUp className="h-4 w-4 text-success" aria-hidden />;
  }
  if (momentum === "declining") {
    return <TrendingDown className="h-4 w-4 text-danger" aria-hidden />;
  }
  return <Minus className="h-4 w-4 text-muted-foreground" aria-hidden />;
}

export function ProductionIntelligencePanel({
  intelligence,
  projectId,
  latestReportHref,
  compact = false,
  topPriority,
  fixPromptContext,
}: {
  intelligence: ProductionIntelligence;
  projectId: string;
  latestReportHref?: string;
  compact?: boolean;
  topPriority?: ProductionPriority | null;
  fixPromptContext?: FixPromptContext;
}) {
  const { t } = useI18n("productionIntelligence");
  const { href } = useDemoNavigation();

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/demo")) return;
    trackEvent("production_intelligence_viewed", { projectId });
  }, [projectId]);

  const action = intelligence.recommendedAction;
  const ctaHref =
    action.ctaKey === "recommendedAction.viewReportCta" && latestReportHref
      ? href(latestReportHref)
      : action.ctaKey === "recommendedAction.viewJourneyCta"
        ? href(`/projects/${projectId}/journey`)
        : href(`/projects/${projectId}/mission-control`);

  const emptyMessage = intelligence.emptyState
    ? t(`emptyStates.${intelligence.emptyState}`)
    : null;

  return (
    <div className="space-y-8">
      {!compact ? (
        <div>
          <p className="text-label-caps">{t("panelTitle")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("panelSubtitle")}</p>
        </div>
      ) : null}

      {emptyMessage ? (
        <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border/60 px-4 py-6">
          {emptyMessage}
        </p>
      ) : null}

      {!compact && intelligence.currentStatus ? (
        <div className="flex flex-wrap items-end gap-4 pb-6 border-b border-border/50">
          <div className="space-y-2">
            <p className="text-label-caps">{t("currentStatus")}</p>
            <VerdictStatusBadge status={intelligence.currentStatus} />
          </div>
          {intelligence.currentScore != null ? (
            <p className="text-display-score">{intelligence.currentScore}</p>
          ) : null}
          <div className="text-sm">
            <p className="text-label-caps">{t("productionMomentum")}</p>
            <p className="flex items-center gap-2 font-medium mt-1">
              <MomentumIcon momentum={intelligence.momentum} />
              {t(`momentum.${intelligence.momentum}`)}
            </p>
          </div>
        </div>
      ) : null}

      <RecommendedAction
        eyebrow={t("recommendedNextAction")}
        title={t(action.titleKey)}
        description={
          action.priorityTitle ??
          (action.descriptionKey ? t(action.descriptionKey) : null)
        }
        action={
          action.ctaKey ? (
            <div className="flex flex-wrap gap-2">
              {action.type === "fix_blocker" && topPriority ? (
                <CopySafeFixPromptButton
                  input={fixPromptInputFromPriority(topPriority, {
                    projectName: fixPromptContext?.projectName,
                    stack: fixPromptContext?.stack,
                    currentVerdictStatus:
                      fixPromptContext?.currentVerdictStatus ?? intelligence.currentStatus ?? undefined,
                    currentScore: fixPromptContext?.currentScore ?? intelligence.currentScore,
                  })}
                  source="intelligence"
                  priorityId={topPriority.id}
                />
              ) : null}
              <Button size="sm" asChild>
                <Link
                  href={ctaHref}
                  onClick={() =>
                    trackEvent("production_intelligence_cta_clicked", {
                      projectId,
                      action: action.type,
                    })
                  }
                >
                  {t(action.ctaKey)}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          ) : null
        }
      />

      {!compact ? (
        <>
          <WhatChangedSection
            items={[...intelligence.improvements, ...intelligence.regressions]}
            hasChanges={intelligence.whatChanged.hasChanges}
          />

          {intelligence.insights.length > 0 ? (
            <section className="space-y-3">
              <p className="text-label-caps">{t("productionInsights")}</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {intelligence.insights.map((insight) => (
                  <li key={insight.id}>{t(insight.messageKey, insight.params)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="pt-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={href(`/projects/${projectId}/journey`)}>{t("viewJourney")}</Link>
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
