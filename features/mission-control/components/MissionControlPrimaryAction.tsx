"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { fixPromptInputFromPriority, findingsByIdMap } from "@/brain/fix-prompt";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { CopySafeFixPromptButton } from "@/features/production-verdict/components/CopySafeFixPromptButton";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import { AnalyzeProjectButton } from "@/features/projects/components/AnalyzeProjectButton";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import type { SecurityTestPhase } from "@/features/security-testing/types";
import { PrimaryActionButton } from "@/features/security-testing/components/SecurityTestHero";
import { useI18n } from "@/lib/i18n/client";

export type MissionControlPrimaryActionKind =
  | "copy_safe_fix"
  | "verify_protection"
  | "run_review_again"
  | "deploy"
  | "run_review"
  | "none";

export function derivePrimaryActionKind(input: {
  verdict: ProductionVerdictV1 | null;
  displayPhase: SecurityTestPhase;
  reviewInProgress: boolean;
}): MissionControlPrimaryActionKind {
  const { verdict, displayPhase, reviewInProgress } = input;

  if (reviewInProgress || displayPhase === "preparing" || displayPhase === "running") {
    return "none";
  }

  if (!verdict) {
    return "run_review";
  }

  if (verdict.status === "ready_to_ship") {
    return "run_review_again";
  }

  if (displayPhase === "protected" || displayPhase === "completed_clean") {
    return "run_review_again";
  }

  if (displayPhase === "fix_ready" || displayPhase === "issues_found") {
    return "verify_protection";
  }

  if ((verdict.topPriorities?.length ?? 0) > 0) {
    return "copy_safe_fix";
  }

  return "run_review_again";
}

export function MissionControlPrimaryAction({
  kind,
  verdict,
  projectId,
  projectName,
  fixPromptContext,
  reviewContext,
  reportHref,
  attackCenterHref,
  analysisRunIsolationEnabled = false,
}: {
  kind: MissionControlPrimaryActionKind;
  verdict: ProductionVerdictV1 | null;
  projectId: string;
  projectName: string;
  fixPromptContext?: FixPromptContext;
  reviewContext: ProjectReviewUiContext | null;
  reportHref?: string;
  attackCenterHref?: string;
  analysisRunIsolationEnabled?: boolean;
}) {
  const router = useRouter();
  const { t: tp } = useI18n("projects");
  const { t: tm } = useI18n("missionControl");

  const topPriority = verdict?.topPriorities?.[0] ?? null;

  const fixPromptInput = useMemo(() => {
    if (!topPriority || !verdict) return null;
    return fixPromptInputFromPriority(topPriority, {
      projectName,
      stack: fixPromptContext?.stack,
      findingsById: fixPromptContext?.findings
        ? findingsByIdMap(fixPromptContext.findings)
        : undefined,
      currentVerdictStatus: verdict.status,
      currentScore: verdict.score,
    });
  }, [fixPromptContext, projectName, topPriority, verdict]);

  if (kind === "none") return null;

  return (
    <section className="space-y-3" aria-labelledby="mission-control-primary-action-heading">
      <h2
        id="mission-control-primary-action-heading"
        className="sr-only"
      >
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

        {kind === "verify_protection" && attackCenterHref ? (
          <PrimaryActionButton onClick={() => router.push(attackCenterHref)}>
            {tm("projectHome.testSecurity.cta")}
          </PrimaryActionButton>
        ) : null}

        {kind === "run_review_again" && reviewContext ? (
          <AnalyzeProjectButton
            projectId={projectId}
            initialContext={reviewContext}
            analysisRunIsolationEnabled={analysisRunIsolationEnabled}
            size="default"
            className="h-12 min-w-[240px] rounded-full text-base px-8"
            labelOverride={tm("actions.reviewAgain")}
          />
        ) : null}

        {kind === "deploy" && reportHref ? (
          <PrimaryActionButton onClick={() => router.push(reportHref)}>
            {tm("actions.deploy")}
          </PrimaryActionButton>
        ) : null}

        {kind === "run_review" && reviewContext ? (
          <AnalyzeProjectButton
            projectId={projectId}
            initialContext={reviewContext}
            analysisRunIsolationEnabled={analysisRunIsolationEnabled}
            size="default"
            className="h-12 min-w-[240px] rounded-full text-base px-8"
            labelOverride={tp("runProductionReview")}
          />
        ) : null}
      </div>
    </section>
  );
}
