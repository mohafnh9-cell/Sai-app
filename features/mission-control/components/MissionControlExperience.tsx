"use client";

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
  return (
    <div className="space-y-12 sm:space-y-16 max-w-3xl mx-auto">
      {securityTestContext && reviewContext ? (
        <SecurityTestPanel
          projectId={view.projectId}
          context={securityTestContext}
          reviewContext={reviewContext}
        />
      ) : null}
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
      {view.cancelledReview ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Production review cancelled</p>
          <p className="mt-1">
            Last phase: {view.cancelledReview.lastCompletedPhase ?? "—"} ·{" "}
            {new Date(view.cancelledReview.cancelledAt).toLocaleString()}
          </p>
        </div>
      ) : null}
      {!view.hideProductionVerdict ? (
        <ProductionVerdictCardSection verdict={view.verdict} />
      ) : null}
    </div>
  );
}
