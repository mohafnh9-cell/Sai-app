"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { SecurityTestContext } from "@/features/security-testing/types";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { useSecurityTestContext } from "@/features/analysis-runs/hooks/useSecurityTestContext";
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
  analysisRunIsolationEnabled = false,
}: {
  projectId: string;
  verdict: ProductionVerdictV1 | null;
  securityTestContext: SecurityTestContext;
  reviewContext: ProjectReviewUiContext;
  analysisRunId?: string | null;
  runScoped?: boolean;
  analysisRunIsolationEnabled?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n("securityTest");
  const { t: tr } = useI18n("readiness");
  const { t: tm } = useI18n("missionControl");
  const [startingBlockerId, setStartingBlockerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: liveSecurityTestContext } = useSecurityTestContext(projectId, {
    analysisRunId: runScoped ? analysisRunId : null,
    initialData: securityTestContext,
    enabled: runScoped,
  });
  const activeSecurityTestContext = runScoped
    ? (liveSecurityTestContext ?? securityTestContext)
    : securityTestContext;

  const phase = activeSecurityTestContext.phase;
  const displayPhase = runScoped
    ? phase
    : phase === "preparing" && verdict
      ? "ready"
      : phase;
  const screenCopy = copyForPhase(displayPhase, t);

  useEffect(() => {
    if (runScoped) return;
    if (displayPhase === "ready") return;
    if (verdict && !reviewContext.productionReviewState.hasActiveReview) return;
    if (phase === "preparing" && verdict) return;
    const shouldPoll =
      activeSecurityTestContext.reviewInProgress ||
      displayPhase === "preparing" ||
      displayPhase === "running" ||
      displayPhase === "issues_found" ||
      displayPhase === "fix_ready";
    if (!shouldPoll || TERMINAL_DISPLAY_PHASES.has(displayPhase)) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [
    activeSecurityTestContext.reviewInProgress,
    displayPhase,
    phase,
    reviewContext.productionReviewState.hasActiveReview,
    router,
    runScoped,
    verdict,
  ]);

  const startValidation = useCallback(
    async (_priorityId?: string) => {
      setStartingBlockerId(_priorityId ?? "all");
      setError(null);
      try {
        const testIds = activeSecurityTestContext.availableTests
          .filter((test) => test.recommended)
          .map((test) => test.id);
        const ids =
          testIds.length > 0
            ? testIds
            : activeSecurityTestContext.availableTests.slice(0, 1).map((test) => test.id);

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

        router.push(body.attackCenterHref ?? activeSecurityTestContext.attackCenterHref);
        router.refresh();
      } catch {
        setError(t("errors.startFailed"));
      } finally {
        setStartingBlockerId(null);
      }
    },
    [activeSecurityTestContext, analysisRunId, projectId, router, t]
  );

  if (displayPhase === "needs_review" || displayPhase === "preparing") {
    return (
      <div className="space-y-10">
        <SecurityTestProgressSteps steps={activeSecurityTestContext.progressSteps} />
        <AnalyzeApplicationPrompt
          projectId={projectId}
          reviewContext={reviewContext}
          preparing={displayPhase === "preparing"}
          waitMessage={screenCopy.waitMessage}
          analysisRunIsolationEnabled={analysisRunIsolationEnabled}
        />
      </div>
    );
  }

  if (!verdict) {
    return (
      <div className="space-y-10">
        <SecurityTestProgressSteps steps={activeSecurityTestContext.progressSteps} />
        <AnalyzeApplicationPrompt
          projectId={projectId}
          reviewContext={reviewContext}
          preparing={false}
          waitMessage={null}
          analysisRunIsolationEnabled={analysisRunIsolationEnabled}
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
        <SecurityTestProgressSteps steps={activeSecurityTestContext.progressSteps} />
      ) : null}

      <ProductionReadinessHero verdict={verdict} />

      {displayPhase === "ready" && blockers.length > 0 ? (
        <DeploymentBlockersList
          blockers={blockers}
          attackCenterHref={activeSecurityTestContext.attackCenterHref}
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
          <PrimaryActionButton onClick={() => router.push(activeSecurityTestContext.attackCenterHref)}>
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
