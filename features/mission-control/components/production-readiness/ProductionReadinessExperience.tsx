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
  analysisRunId = null,
  runScoped = false,
}: {
  projectId: string;
  verdict: ProductionVerdictV1 | null;
  securityTestContext: SecurityTestContext;
  reviewContext: ProjectReviewUiContext;
  analysisRunId?: string | null;
  runScoped?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n("securityTest");
  const { t: tr } = useI18n("readiness");
  const { t: tm } = useI18n("missionControl");
  const [startingBlockerId, setStartingBlockerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const phase = securityTestContext.phase;
  const displayPhase = runScoped
    ? phase
    : phase === "preparing" && verdict
      ? "ready"
      : phase;
  const screenCopy = copyForPhase(displayPhase, t);

  useEffect(() => {
    if (displayPhase === "ready") return;
    if (verdict && !reviewContext.productionReviewState.hasActiveReview) return;
    if (phase === "preparing" && verdict) return;
    const shouldPoll =
      securityTestContext.reviewInProgress ||
      displayPhase === "preparing" ||
      displayPhase === "running" ||
      displayPhase === "issues_found" ||
      displayPhase === "fix_ready";
    if (!shouldPoll || TERMINAL_DISPLAY_PHASES.has(displayPhase)) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [
    displayPhase,
    phase,
    reviewContext.productionReviewState.hasActiveReview,
    securityTestContext.reviewInProgress,
    router,
    verdict,
  ]);

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
          body: JSON.stringify({
            testIds: ids,
            ...(analysisRunId ? { analysisRunId } : {}),
          }),
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
      } catch {
        setError(t("errors.startFailed"));
      } finally {
        setStartingBlockerId(null);
      }
    },
    [analysisRunId, projectId, router, securityTestContext, t]
  );

  if (displayPhase === "needs_review" || displayPhase === "preparing") {
    return (
      <div className="space-y-10">
        <SecurityTestProgressSteps steps={securityTestContext.progressSteps} />
        <AnalyzeApplicationPrompt
          projectId={projectId}
          reviewContext={reviewContext}
          preparing={displayPhase === "preparing"}
          waitMessage={screenCopy.waitMessage}
        />
      </div>
    );
  }

  if (!verdict) {
    return (
      <div className="space-y-10">
        <SecurityTestProgressSteps steps={securityTestContext.progressSteps} />
        <AnalyzeApplicationPrompt
          projectId={projectId}
          reviewContext={reviewContext}
          preparing={false}
          waitMessage={null}
        />
      </div>
    );
  }

  const blockers = verdict.topPriorities ?? [];
  const showProgress = displayPhase !== "completed_clean" && displayPhase !== "protected";
  const reportHref = `/projects/${projectId}/scans/${verdict.scanId}/report`;

  return (
    <div className="space-y-10">
      {showProgress ? (
        <SecurityTestProgressSteps steps={securityTestContext.progressSteps} />
      ) : null}

      <ProductionReadinessHero verdict={verdict} />

      {displayPhase === "ready" && blockers.length > 0 ? (
        <DeploymentBlockersList
          blockers={blockers}
          attackCenterHref={securityTestContext.attackCenterHref}
          primaryActionLabel={screenCopy.primaryActionLabel}
          onPrimaryValidation={() => void startValidation()}
          startingPrimary={startingBlockerId === "all"}
        />
      ) : null}

      {displayPhase === "ready" && blockers.length === 0 ? (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-4">
          <p className="font-medium">{tr("ready.noBlockersTitle")}</p>
          <p className="text-sm text-muted-foreground">{tr("ready.noBlockersDescription")}</p>
          <PrimaryActionButton onClick={() => void startValidation()}>
            {tr("ready.runValidation")}
          </PrimaryActionButton>
        </section>
      ) : null}

      {(displayPhase === "running" ||
        displayPhase === "issues_found" ||
        displayPhase === "fix_ready") && (
        <section className="rounded-2xl border border-primary/20 bg-primary/5 p-6 space-y-4">
          <p className="font-medium">{screenCopy.headline}</p>
          <p className="text-sm text-muted-foreground">{screenCopy.description}</p>
          <PrimaryActionButton onClick={() => router.push(securityTestContext.attackCenterHref)}>
            {screenCopy.primaryActionLabel}
          </PrimaryActionButton>
        </section>
      )}

      {(displayPhase === "protected" || displayPhase === "completed_clean") && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center space-y-4">
          <p className="text-2xl font-semibold tracking-tight">{screenCopy.headline}</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{screenCopy.description}</p>
          {verdict.status === "ready_to_ship" ? (
            <PrimaryActionButton onClick={() => router.push(reportHref)}>
              {tm("actions.deploy")}
            </PrimaryActionButton>
          ) : (
            <PrimaryActionButton onClick={() => router.push(`/projects/${projectId}/mission-control`)}>
              {screenCopy.primaryActionLabel}
            </PrimaryActionButton>
          )}
        </section>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
