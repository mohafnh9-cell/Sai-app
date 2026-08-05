"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { fixPromptInputFromPriority, findingsByIdMap } from "@/brain/fix-prompt";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { CopySafeFixPromptButton } from "@/features/production-verdict/components/CopySafeFixPromptButton";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import { AnalyzeProjectButton } from "@/features/projects/components/AnalyzeProjectButton";
import type { MissionControlPrimaryActionKind } from "@/features/mission-control/types/mission-control-state";
import { PrimaryActionButton } from "@/features/security-testing/components/SecurityTestHero";
import { useI18n } from "@/lib/i18n/client";

export type { MissionControlPrimaryActionKind };

export function MissionControlPrimaryAction({
  kind,
  verdict,
  projectName,
  fixPromptContext,
  reportHref,
  attackCenterHref,
  scanLabel,
  scanLoading,
  scanDisabled,
  scanProgress,
  onStartScan,
}: {
  kind: MissionControlPrimaryActionKind;
  verdict: ProductionVerdictV1 | null;
  projectName: string;
  fixPromptContext?: FixPromptContext;
  reportHref?: string;
  attackCenterHref?: string;
  scanLabel: string;
  scanLoading: boolean;
  scanDisabled: boolean;
  scanProgress: string | null;
  onStartScan: () => void;
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

        {kind === "verify_protection" && attackCenterHref ? (
          <PrimaryActionButton onClick={() => router.push(attackCenterHref)}>
            {tm("projectHome.testSecurity.cta")}
          </PrimaryActionButton>
        ) : null}

        {kind === "run_review_again" ? (
          <AnalyzeProjectButton
            label={scanLabel}
            loading={scanLoading}
            disabled={scanDisabled}
            progress={scanProgress}
            onClick={onStartScan}
            size="default"
            className="h-12 min-w-[240px] rounded-full text-base px-8"
          />
        ) : null}

        {kind === "deploy" && reportHref ? (
          <PrimaryActionButton onClick={() => router.push(reportHref)}>
            {tm("actions.deploy")}
          </PrimaryActionButton>
        ) : null}

        {kind === "run_review" ? (
          <AnalyzeProjectButton
            label={scanLabel}
            loading={scanLoading}
            disabled={scanDisabled}
            progress={scanProgress}
            onClick={onStartScan}
            size="default"
            className="h-12 min-w-[240px] rounded-full text-base px-8"
          />
        ) : null}
      </div>
    </section>
  );
}
