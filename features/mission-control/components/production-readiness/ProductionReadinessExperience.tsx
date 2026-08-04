"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { SecurityTestContext } from "@/features/security-testing/types";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { SecurityTestProgressSteps } from "@/features/security-testing/components/SecurityTestProgressSteps";
import { PrimaryActionButton } from "@/features/security-testing/components/SecurityTestHero";
import { copyForPhase } from "@/features/security-testing/lib/product-copy";
import { TERMINAL_DISPLAY_PHASES } from "@/features/security-testing/lib/derive-phase";
import { useI18n } from "@/lib/i18n/client";
import { AnalyzeApplicationPrompt } from "./AnalyzeApplicationPrompt";
import { DeploymentBlockersList } from "./DeploymentBlockersList";
import { ProductionReadinessHero } from "./ProductionReadinessHero";

export function ProductionReadinessExperience({
  projectId,
  verdict,
  securityTestContext,
  reviewContext,
}: {
  projectId: string;
  verdict: ProductionVerdictV1 | null;
  securityTestContext: SecurityTestContext;
  reviewContext: ProjectReviewUiContext;
}) {
  const router = useRouter();
  const { t } = useI18n("securityTest");
  const { t: tr } = useI18n("readiness");
  const [startingBlockerId, setStartingBlockerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const phase = securityTestContext.phase;
  const screenCopy = copyForPhase(phase, t);

  useEffect(() => {
    const shouldPoll =
      securityTestContext.reviewInProgress ||
      phase === "preparing" ||
      phase === "running" ||
      phase === "issues_found" ||
      phase === "fix_ready";
    if (!shouldPoll || TERMINAL_DISPLAY_PHASES.has(phase)) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [phase, securityTestContext.reviewInProgress, router]);

  const startValidation = useCallback(
    async (_priorityId?: string) => {
      setStartingBlockerId(_priorityId ?? "all");
      setError(null);
      try {
        const testIds = securityTestContext.availableTests
          .filter((test) => test.recommended)
          .map((test) => test.id);
        const ids =
          testIds.length > 0
            ? testIds
            : securityTestContext.availableTests.slice(0, 1).map((test) => test.id);

        const response = await fetch(`/api/projects/${projectId}/security-tests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ testIds: ids }),
        });
        const body = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          attackCenterHref?: string;
        } | null;

        if (!response.ok || !body?.ok) {
          setError(body?.error ?? t("errors.startFailed"));
          return;
        }

        router.push(body.attackCenterHref ?? securityTestContext.attackCenterHref);
        router.refresh();
      } finally {
        setStartingBlockerId(null);
      }
    },
    [projectId, router, securityTestContext, t]
  );

  if (phase === "needs_review" || phase === "preparing") {
    return (
      <div className="space-y-10">
        <SecurityTestProgressSteps steps={securityTestContext.progressSteps} />
        <AnalyzeApplicationPrompt
          projectId={projectId}
          reviewContext={reviewContext}
          preparing={phase === "preparing"}
          waitMessage={screenCopy.waitMessage}
        />
      </div>
    );
  }

  const blockers = verdict?.topPriorities ?? [];
  const showVerdict = Boolean(verdict);
  const showProgress = phase !== "completed_clean" && phase !== "protected";

  return (
    <div className="space-y-10">
      {showProgress ? (
        <SecurityTestProgressSteps steps={securityTestContext.progressSteps} />
      ) : null}

      {showVerdict ? <ProductionReadinessHero verdict={verdict!} /> : null}

      {phase === "ready" && blockers.length > 0 ? (
        <DeploymentBlockersList
          blockers={blockers}
          attackCenterHref={securityTestContext.attackCenterHref}
          onStartValidation={(priority) => void startValidation(priority.id)}
          startingId={startingBlockerId}
        />
      ) : null}

      {phase === "ready" && blockers.length === 0 ? (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-4">
          <p className="font-medium">{tr("ready.noBlockersTitle")}</p>
          <p className="text-sm text-muted-foreground">{tr("ready.noBlockersDescription")}</p>
          <PrimaryActionButton onClick={() => void startValidation()}>
            {tr("ready.runValidation")}
          </PrimaryActionButton>
        </section>
      ) : null}

      {(phase === "running" || phase === "issues_found" || phase === "fix_ready") && (
        <section className="rounded-2xl border border-primary/20 bg-primary/5 p-6 space-y-4">
          <p className="font-medium">{screenCopy.headline}</p>
          <p className="text-sm text-muted-foreground">{screenCopy.description}</p>
          <PrimaryActionButton onClick={() => router.push(securityTestContext.attackCenterHref)}>
            {screenCopy.primaryActionLabel}
          </PrimaryActionButton>
        </section>
      )}

      {(phase === "protected" || phase === "completed_clean") && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center space-y-4">
          <p className="text-2xl font-semibold tracking-tight">{screenCopy.headline}</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{screenCopy.description}</p>
          <PrimaryActionButton onClick={() => router.push(`/projects/${projectId}/mission-control`)}>
            {screenCopy.primaryActionLabel}
          </PrimaryActionButton>
        </section>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
