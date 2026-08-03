"use client";

import { useI18n } from "@/lib/i18n/client";
import { formatLocalizedDate } from "@/lib/i18n/format";
import type { MissionControlView } from "../types";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import { MissionHeader } from "./MissionHeader";
import { ActiveTeams } from "./ActiveTeams";
import { WhyTheseTeams } from "./WhyTheseTeams";
import { MissionFeed } from "./MissionFeed";
import { CurrentObjective } from "./CurrentObjective";
import { ProductionVerdictCardSection } from "./ProductionVerdictCard";
import { SecurityTestPanel } from "@/features/security-testing/components/SecurityTestPanel";
import type { SecurityTestContext } from "@/features/security-testing/types";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";

export function MissionControlExperience({
  view,
  verdict,
  fixPromptContext,
  securityTestContext = null,
  reviewContext = null,
}: {
  view: MissionControlView;
  verdict: ProductionVerdictV1 | null;
  fixPromptContext?: FixPromptContext;
  securityTestContext?: SecurityTestContext | null;
  reviewContext?: ProjectReviewUiContext | null;
}) {
  const { t, locale } = useI18n("missionControl");
  const guidedFlowActive = Boolean(securityTestContext && reviewContext);

  return (
    <div className="space-y-12 sm:space-y-16 max-w-2xl mx-auto">
      {guidedFlowActive ? (
        <SecurityTestPanel
          projectId={view.projectId}
          context={securityTestContext!}
          reviewContext={reviewContext!}
        />
      ) : null}

      {!guidedFlowActive ? (
        <>
          <MissionHeader header={view.header} />
          <ActiveTeams teams={view.teams} />
          <WhyTheseTeams reasons={view.teamReasons} />
          <MissionFeed items={view.feed} />
          <CurrentObjective
            objective={view.objective}
            projectId={view.projectId}
            verdict={view.hideProductionVerdict ? null : verdict}
            fixPromptContext={view.hideProductionVerdict ? undefined : fixPromptContext}
          />
        </>
      ) : (
        <details className="rounded-2xl border border-border/60 group">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-muted-foreground list-none">
            {t("technicalDetails")}
          </summary>
          <div className="px-5 pb-8 space-y-12 border-t border-border/40 pt-8">
            <MissionHeader header={view.header} />
            <ActiveTeams teams={view.teams} />
            <WhyTheseTeams reasons={view.teamReasons} />
            <MissionFeed items={view.feed} />
            {!view.hideProductionVerdict ? (
              <ProductionVerdictCardSection verdict={view.verdict} />
            ) : null}
          </div>
        </details>
      )}

      {view.cancelledReview ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("feed.reviewStopped")}</p>
          <p className="mt-1">{formatLocalizedDate(locale, view.cancelledReview.cancelledAt)}</p>
        </div>
      ) : null}

      {!guidedFlowActive && !view.hideProductionVerdict ? (
        <ProductionVerdictCardSection verdict={view.verdict} />
      ) : null}
    </div>
  );
}
