"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { fixPromptInputFromPriority, findingsByIdMap } from "@/brain/fix-prompt";
import { CopySafeFixPromptButton } from "@/features/production-verdict/components/CopySafeFixPromptButton";
import { AnalyzeProjectButton } from "@/features/projects/components/AnalyzeProjectButton";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import { PrimaryActionButton } from "@/features/security-testing/components/SecurityTestHero";
import { useI18n } from "@/lib/i18n/client";

const SCAN_LABEL_KEYS = {
  cta: "projectHome.scanCode.cta",
  running: "projectHome.scanCode.running",
  rescan: "projectHome.scanCode.rescan",
  retry: "projectHome.scanCode.retry",
} as const;

export function MissionControlPrimaryAction({
  state,
  scanAction,
  onStartScan,
  hidden = false,
}: {
  state: MissionControlState;
  scanAction: MissionControlState["actions"]["scan"] & {
    label: MissionControlState["actions"]["scan"]["label"];
  };
  onStartScan: () => void;
  hidden?: boolean;
}) {
  const router = useRouter();
  const { t: tp } = useI18n("projects");
  const { t: tm } = useI18n("missionControl");

  const kind = hidden ? "none" : state.actions.primary.kind;
  const verdict = state.productionVerdict;
  const topPriority = verdict?.topPriorities?.[0] ?? null;

  const fixPromptInput = useMemo(() => {
    if (!topPriority || !verdict) return null;
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

  const scanProgress =
    state.status.reviewInProgress && state.status.progressMessage
      ? state.status.progressMessage
      : state.status.reviewInProgress && state.status.progress != null
        ? `${state.status.progress}%`
        : null;

  const scanLabel =
    kind === "run_review"
      ? tp("runProductionReview")
      : kind === "run_review_again"
        ? tm("actions.reviewAgain")
        : tm(SCAN_LABEL_KEYS[scanAction.label]);

  if (kind === "none") return null;

  return (
    <section className="space-y-3" aria-labelledby="mission-control-primary-action-heading">
      <h2 id="mission-control-primary-action-heading" className="sr-only">
        {tm("sections.primaryAction")}
      </h2>
      <div className="flex justify-center sm:justify-start">
        {kind === "copy_safe_fix" && fixPromptInput && topPriority ? (
          <CopySafeFixPromptButton
            input={fixPromptInput}
            source="priority"
            priorityId={topPriority.id}
            size="default"
            variant="default"
            className="h-12 min-w-[240px] rounded-full text-base px-8"
            label={tm("projectHome.aiFix.openInCursor")}
            copiedLabel={tp("copiedSafeFix")}
          />
        ) : null}

        {kind === "verify_protection" && state.ui.attackCenterHref ? (
          <PrimaryActionButton onClick={() => router.push(state.ui.attackCenterHref!)}>
            {tm("projectHome.testSecurity.cta")}
          </PrimaryActionButton>
        ) : null}

        {kind === "run_review_again" || kind === "run_review" ? (
          <AnalyzeProjectButton
            label={scanLabel}
            loading={scanAction.showSpinner}
            disabled={scanAction.disabled}
            progress={scanProgress}
            onClick={onStartScan}
            size="default"
            className="h-12 min-w-[240px] rounded-full text-base px-8"
          />
        ) : null}

        {kind === "deploy" && state.ui.reportHref ? (
          <PrimaryActionButton onClick={() => router.push(state.ui.reportHref!)}>
            {tm("actions.deploy")}
          </PrimaryActionButton>
        ) : null}
      </div>
    </section>
  );
}
