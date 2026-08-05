"use client";

import { useMemo } from "react";
import { formatLocalizedDate } from "@/lib/i18n/format";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import { useMissionControlState } from "@/features/mission-control/hooks/useMissionControlState";
import { useI18n } from "@/lib/i18n/client";
import { DeploymentBlockersList } from "./production-readiness/DeploymentBlockersList";
import { ProjectHomeActions } from "./ProjectHomeActions";
import { MissionControlHero } from "./MissionControlHero";
import {
  MissionControlPrimaryAction,
  derivePrimaryActionKind,
} from "./MissionControlPrimaryAction";
import { SafeFixHeroCard } from "@/features/production-verdict/components/SafeFixHeroCard";
import { fixPromptInputFromPriority, findingsByIdMap } from "@/brain/fix-prompt";
import { MissionControlTechnicalDetails } from "./MissionControlTechnicalDetails";
import { MissionControlProtectionStatus } from "./MissionControlProtectionStatus";

export function MissionControlExperience({
  initialState,
}: {
  initialState: MissionControlState;
}) {
  const { t, locale } = useI18n("missionControl");
  const {
    state,
    scanAction,
    securityAction,
    actionError,
    startScan,
    startSecurityTest,
  } = useMissionControlState(initialState.projectId, {
    initialState,
    analysisRunId: initialState.analysisRunId,
  });

  const verdict = state.productionVerdict;
  const securityPhase = state.securityTestContext?.phase ?? "needs_review";

  const primaryActionKind = derivePrimaryActionKind({
    verdict,
    displayPhase: securityPhase,
    reviewInProgress: state.status.reviewInProgress,
  });

  const topPriority = verdict?.topPriorities?.[0] ?? null;
  const safeFixPromptInput = useMemo(() => {
    if (!topPriority || !verdict || verdict.status === "ready_to_ship") return null;
    return fixPromptInputFromPriority(topPriority, {
      projectName: state.projectName,
      stack: state.ui.fixPromptContext?.stack,
      findingsById: state.ui.fixPromptContext?.findings
        ? findingsByIdMap(state.ui.fixPromptContext.findings)
        : undefined,
      currentVerdictStatus: verdict.status,
      currentScore: verdict.score,
    });
  }, [state.projectName, state.ui.fixPromptContext, topPriority, verdict]);

  const showSafeFixCard =
    primaryActionKind === "copy_safe_fix" && topPriority && safeFixPromptInput;

  const blockers = verdict?.topPriorities ?? [];
  const showBlockers = blockers.length > 0 && verdict?.status !== "ready_to_ship";

  return (
    <div className="space-y-10 max-w-2xl mx-auto">
      <ProjectHomeActions
        state={state}
        scanAction={scanAction}
        securityAction={securityAction}
        actionError={actionError}
        onStartScan={() => void startScan()}
        onStartSecurityTest={() => void startSecurityTest()}
      />

      {state.status.reviewInProgress && !verdict ? (
        <div
          className="rounded-2xl border border-border/60 bg-muted/20 px-5 py-4 text-sm text-muted-foreground text-center"
          role="status"
        >
          {t("sections.reviewInProgress")}
        </div>
      ) : null}

      {verdict ? (
        <>
          <MissionControlHero verdict={verdict} />

          {showBlockers ? <DeploymentBlockersList blockers={blockers} /> : null}

          {showSafeFixCard ? (
            <SafeFixHeroCard
              topPriority={topPriority}
              fixPromptInput={safeFixPromptInput}
              labels={{
                eyebrow: t("projectHome.aiFix.title"),
                copyLabel: t("projectHome.aiFix.openInCursor"),
              }}
            />
          ) : null}

          <MissionControlPrimaryAction
            kind={showSafeFixCard ? "none" : primaryActionKind}
            verdict={verdict}
            projectId={state.projectId}
            projectName={state.projectName}
            fixPromptContext={state.ui.fixPromptContext}
            reviewContext={state.reviewContext}
            reportHref={state.ui.reportHref}
            attackCenterHref={state.ui.attackCenterHref}
            analysisRunIsolationEnabled={state.flags.analysisRunIsolationEnabled}
          />

          {state.ui.showProtectionStatus && (
            <MissionControlProtectionStatus
              projectId={state.projectId}
              initialData={state.protectionCenter}
              enabled={state.ui.showProtectionStatus}
            />
          )}

          <MissionControlTechnicalDetails
            view={state.view}
            verdict={verdict}
            framework={state.framework}
            reportHref={state.ui.reportHref}
            openByDefault={state.ui.openTechnicalDetails}
          />
        </>
      ) : null}

      {state.view.cancelledReview ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("feed.reviewStopped")}</p>
          <p className="mt-1">{formatLocalizedDate(locale, state.view.cancelledReview.cancelledAt)}</p>
        </div>
      ) : null}
    </div>
  );
}
