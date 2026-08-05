import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MissionControlExperience } from "@/features/mission-control/components/MissionControlExperience";
import { ProjectWorkflowNav } from "@/features/mission-control/components/ProjectWorkflowNav";
import { shouldShowSecurityTestNav } from "@/features/mission-control/lib/navigation";
import { ProjectOnboardedBanner } from "@/features/projects/components/ProjectOnboardedBanner";
import { loadMissionControlWithRecovery } from "@/server/mission-control/load-mission-control-with-recovery";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { isFeatureEnabled } from "@/server/feature-flags";
import { fixPromptContextFromScan } from "@/features/production-verdict/fix-prompt-context";
import { tryCreateMissionControlAdminClient } from "@/server/mission-control/try-create-admin-client";
import { getProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { getSecurityTestContext } from "@/server/attack-simulation/get-security-test-context";
import { getProtectionCenterModel } from "@/server/continuous-protection/protection-context";
import { resolveAnalysisRunForMissionControl } from "@/server/analysis-runs/resolve-analysis-run";
import { loadAnalysisRunFindingsForFixPrompt } from "@/server/analysis-runs/load-run-findings-for-fix";
import { listAnalysisRunsForProject } from "@/server/analysis-runs/list-analysis-runs";
import { appendAnalysisRunSearchParams } from "@/features/analysis-runs/lib/build-run-query";
import { AnalysisRunSelector } from "@/features/analysis-runs/components/AnalysisRunSelector";
import type { SecurityTestContext } from "@/features/security-testing/types";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { toRscSafe } from "@/lib/rsc/to-rsc-safe";
import { findNonSerializablePaths } from "@/lib/rsc/find-non-serializable-path";
import { missionControlTrace, traceAwait } from "@/lib/debug/mission-control-trace";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    connected?: string;
    reviewComplete?: string;
    onboarded?: string;
    run?: string;
    recovery?: string;
    technical?: string;
  }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getTranslator("missionControl");
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) return { title: t("page.title") };
  const { data } = await auth.supabase.from("projects").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ? `${data.name} — ${t("page.title")}` : t("page.title") };
}

function buildMissionControlSearchParams(input: {
  run?: string;
  connected?: string;
  reviewComplete?: string;
  onboarded?: string;
}): string {
  const params = new URLSearchParams();
  appendAnalysisRunSearchParams(params, input.run);
  if (input.connected === "1") params.set("connected", "1");
  if (input.reviewComplete === "1") params.set("reviewComplete", "1");
  if (input.onboarded === "1") params.set("onboarded", "1");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function MissionControlPage({ params, searchParams }: PageProps) {
  const { id: projectId } = await params;
  const query = await searchParams;
  const traceCtx = { projectId, runId: query.run ?? null };

  missionControlTrace("MissionControlPage", "START", traceCtx);

  const auth = await traceAwait("getCachedServerAuthContext", traceCtx, () =>
    getCachedServerAuthContext()
  );
  if (!auth?.organizationId) redirect("/login");
  const organizationId = auth.organizationId;

  const isolationEnabled = isFeatureEnabled("analysis_run_isolation", {
    organizationId,
  });

  const continuousProtectionEnabled = isFeatureEnabled("continuous_protection", {
    organizationId,
  });

  const attackCenterEnabled = isFeatureEnabled("attack_simulation", {
    organizationId,
  });

  const projectResult = await traceAwait("projects.select", traceCtx, async () =>
    auth.supabase
      .from("projects")
      .select("id, name, framework")
      .eq("id", projectId)
      .maybeSingle()
  );
  const project = projectResult.data;

  if (!project) notFound();

  const manualRecovery = query.recovery === "1";
  let analysisRunId: string | null = manualRecovery ? null : (query.run ?? null);

  if (isolationEnabled && !manualRecovery) {
    const admin = tryCreateMissionControlAdminClient();
    if (!admin) {
      console.error({
        component: "mission-control-page",
        event: "isolation_admin_unavailable",
        projectId,
      });
      if (query.run) {
        redirect(
          `/projects/${projectId}/mission-control${buildMissionControlSearchParams({
            connected: query.connected,
            reviewComplete: query.reviewComplete,
            onboarded: query.onboarded,
          })}`
        );
      }
      analysisRunId = null;
    } else {
      let resolved: Awaited<ReturnType<typeof resolveAnalysisRunForMissionControl>>;
      try {
        resolved = await traceAwait(
          "resolveAnalysisRunForMissionControl",
          { ...traceCtx, analysisRunId: query.run ?? null },
          () =>
            resolveAnalysisRunForMissionControl(admin, {
              projectId,
              organizationId,
              requestedRunId: query.run,
            })
        );
      } catch (error) {
        console.error({
          component: "mission-control-page",
          event: "analysis_run_resolve_failed",
          projectId,
          run: query.run,
          error: error instanceof Error ? error.message : String(error),
        });
        if (query.run) {
          redirect(
            `/projects/${projectId}/mission-control${buildMissionControlSearchParams({
              connected: query.connected,
              reviewComplete: query.reviewComplete,
              onboarded: query.onboarded,
            })}`
          );
        }
        resolved = { runId: null, source: "none", valid: true };
      }

      if (query.run && !resolved.valid) {
        redirect(
          `/projects/${projectId}/mission-control${buildMissionControlSearchParams({
            connected: query.connected,
            reviewComplete: query.reviewComplete,
            onboarded: query.onboarded,
          })}`
        );
      }

      if (!query.run && resolved.runId) {
        redirect(
          `/projects/${projectId}/mission-control${buildMissionControlSearchParams({
            run: resolved.runId,
            connected: query.connected,
            reviewComplete: query.reviewComplete,
            onboarded: query.onboarded,
          })}`
        );
      }

      analysisRunId = resolved.runId;
    }
  }

  let reviewContext: ProjectReviewUiContext | null = null;
  try {
    reviewContext = await traceAwait("getProjectReviewUiContext", traceCtx, () =>
      getProjectReviewUiContext(auth.supabase, projectId)
    );
  } catch (error) {
    console.error({
      component: "mission-control-page",
      event: "review_context_failed",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const adminClient = tryCreateMissionControlAdminClient();
  const analysisRuns =
    isolationEnabled && adminClient
      ? await traceAwait("listAnalysisRunsForProject", traceCtx, async () =>
          listAnalysisRunsForProject(adminClient, {
            projectId,
            organizationId,
          }).catch(() => [])
        )
      : [];

  const missionLoad = await traceAwait(
    "loadMissionControlWithRecovery",
    { ...traceCtx, analysisRunId },
    async () =>
      loadMissionControlWithRecovery(auth.supabase, projectId, organizationId, {
        analysisRunId,
        isolationEnabled,
        manualRecovery,
        admin: adminClient,
      })
  );

  const { view, verdict, runScoped, activeRunId, recoveryReason } = missionLoad;

  const findingsRunId = runScoped && activeRunId ? activeRunId : null;

  const scanForContext = findingsRunId
    ? await traceAwait(
        "scans.select.runScoped",
        { ...traceCtx, scanId: findingsRunId },
        async () =>
          auth.supabase
            .from("scans")
            .select("id, detected_stack, status")
            .eq("id", findingsRunId)
            .eq("project_id", projectId)
            .maybeSingle()
      )
    : await traceAwait("scans.select.latestCompleted", traceCtx, async () =>
        auth.supabase
          .from("scans")
          .select("id, detected_stack, status")
          .eq("project_id", projectId)
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      );

  const contextScan = scanForContext.data;

  const runFindings =
    isolationEnabled && findingsRunId
      ? await traceAwait(
          "loadAnalysisRunFindingsForFixPrompt",
          { ...traceCtx, scanId: findingsRunId },
          async () => loadAnalysisRunFindingsForFixPrompt(auth.supabase, findingsRunId)
        )
      : undefined;

  const latestReportHref =
    contextScan?.id && (contextScan.status === "completed" || !isolationEnabled)
      ? `/projects/${projectId}/scans/${contextScan.id}/report`
      : undefined;

  const fixPromptContext = verdict
    ? fixPromptContextFromScan({
        projectName: project.name,
        detectedStack: contextScan?.detected_stack,
        framework: project.framework,
        findings: runFindings,
        currentVerdictStatus: verdict.status,
        currentScore: verdict.score,
      })
    : undefined;

  let securityTestContext: SecurityTestContext | null = null;

  if (attackCenterEnabled && reviewContext) {
    try {
      const admin = adminClient ?? tryCreateMissionControlAdminClient();
      if (admin) {
        const fullContext = await traceAwait(
          "getSecurityTestContext",
          { ...traceCtx, analysisRunId: runScoped && activeRunId ? activeRunId : null },
          () =>
            getSecurityTestContext(admin, {
              projectId,
              organizationId,
              analysisRunId: runScoped && activeRunId ? activeRunId : undefined,
              isolationEnabled,
            })
        );
        const { hypotheses: _hypotheses, analysisRunId: _runId, ...publicContext } = fullContext;
        securityTestContext = publicContext;
      }
    } catch (error) {
      console.warn({
        component: "mission-control-page",
        event: "security_test_context_failed",
        projectId,
        analysisRunId: activeRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      securityTestContext = null;
    }
  }

  const { t } = await getTranslator("missionControl");
  const { t: tp } = await getTranslator("projects");

  const viewingHistoricalRun =
    isolationEnabled &&
    runScoped &&
    activeRunId &&
    reviewContext?.productionReviewState?.scanId &&
    reviewContext.productionReviewState?.hasActiveReview &&
    reviewContext.productionReviewState.scanId !== activeRunId;

  const showSecurityTest = shouldShowSecurityTestNav({ attackCenterEnabled });

  const showProtectionStatus =
    continuousProtectionEnabled && Boolean(verdict) && !viewingHistoricalRun;

  const protectionCenter =
    showProtectionStatus && adminClient
      ? await traceAwait("getProtectionCenterModel", traceCtx, async () =>
          getProtectionCenterModel(adminClient, projectId).catch(() => null)
        )
      : null;

  const showRecoveryBanner =
    manualRecovery || recoveryReason === "scoped_verdict_missing" || recoveryReason === "manual_recovery";

  const recoveryBannerKey =
    recoveryReason === "scoped_verdict_missing"
      ? "analysisRun.autoRecoveryBanner"
      : "analysisRun.recoveryBanner";

  const rawExperienceProps = {
    view,
    verdict,
    projectName: project.name,
    framework: project.framework ?? null,
    fixPromptContext,
    securityTestContext,
    reviewContext,
    analysisRunId: isolationEnabled && runScoped ? activeRunId : null,
    runScoped,
    analysisRunIsolationEnabled: isolationEnabled,
    reportHref: latestReportHref,
    openTechnicalDetails: query.technical === "open",
    protectionCenter,
    showProtectionStatus,
    isVerdictStale: Boolean(reviewContext?.isStale && !viewingHistoricalRun),
    attackCenterEnabled,
  };

  const rscIssues = findNonSerializablePaths(rawExperienceProps, {
    rootLabel: "experienceProps",
  });
  if (rscIssues.length > 0) {
    console.error({
      component: "mission-control-rsc-audit",
      event: "non_serializable_props_detected",
      projectId,
      runId: activeRunId,
      scanId: findingsRunId,
      issues: rscIssues,
    });
  }

  const experienceProps = toRscSafe(rawExperienceProps);

  missionControlTrace("MissionControlPage", "END", {
    ...traceCtx,
    analysisRunId: activeRunId,
    scanId: findingsRunId,
    runScoped,
    hasVerdict: Boolean(verdict),
    rscIssueCount: rscIssues.length,
  });

  return (
    <div className="app-cinematic-bg min-h-full">
      <div className="mx-auto max-w-4xl px-4 sm:px-8 pb-24 pt-6 sm:pt-10">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 text-muted-foreground mb-8">
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
            {t("page.backToMissionControl")}
          </Link>
        </Button>
        <ProjectWorkflowNav
          projectId={projectId}
          analysisRunId={isolationEnabled && runScoped ? activeRunId : undefined}
          showSecurityTest={showSecurityTest}
        />

        {viewingHistoricalRun ? (
          <div
            className="rounded-2xl border border-border/60 bg-muted/20 px-5 py-4 text-sm text-muted-foreground mb-8"
            role="status"
          >
            {t("analysisRun.historicalBanner")}
          </div>
        ) : null}

        {showRecoveryBanner ? (
          <div
            className="rounded-2xl border border-brand-warning/30 bg-brand-warning/5 px-5 py-4 text-sm text-foreground/90 mb-8"
            role="status"
          >
            {t(recoveryBannerKey)}
          </div>
        ) : null}

        {isolationEnabled && analysisRuns.length > 1 ? (
          <Suspense fallback={null}>
            <AnalysisRunSelector runs={analysisRuns} activeRunId={activeRunId} />
          </Suspense>
        ) : null}

        {query.onboarded === "1" && verdict ? (
          <ProjectOnboardedBanner readyToShip={verdict.status === "ready_to_ship"} />
        ) : null}

        {query.connected === "1" ? (
          <div className="surface-premium rounded-2xl p-5 mb-8" role="status">
            <p className="text-sm font-medium">{tp("connectedGuidanceTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{tp("connectedGuidanceBody")}</p>
          </div>
        ) : null}

        {query.reviewComplete === "1" && verdict ? (
          <div className="surface-premium rounded-2xl p-5 mb-8" role="status">
            <p className="text-sm font-medium">{tp("reviewCompleteGuidanceTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{tp("reviewCompleteGuidanceBody")}</p>
          </div>
        ) : null}

        {reviewContext?.isStale && !viewingHistoricalRun ? (
          <div
            className="rounded-2xl border border-brand-warning/30 bg-brand-warning/5 px-5 py-4 text-sm text-foreground/90 mb-8"
            role="alert"
          >
            {tp("latestCommitNotReviewedBanner")}
          </div>
        ) : null}

        <MissionControlExperience {...experienceProps} />
      </div>
    </div>
  );
}
