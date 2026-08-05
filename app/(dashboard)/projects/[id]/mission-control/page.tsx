import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MissionControlExperience } from "@/features/mission-control/components/MissionControlExperience";
import { ProjectWorkflowNav } from "@/features/mission-control/components/ProjectWorkflowNav";
import { shouldShowSecurityTestNav } from "@/features/mission-control/lib/navigation";
import { loadFullMissionControlState } from "@/server/mission-control/load-full-mission-control-state";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { isFeatureEnabled } from "@/server/feature-flags";
import { tryCreateMissionControlAdminClient } from "@/server/mission-control/try-create-admin-client";
import { resolveAnalysisRunForMissionControl } from "@/server/analysis-runs/resolve-analysis-run";
import { appendAnalysisRunSearchParams } from "@/features/analysis-runs/lib/build-run-query";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
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

  const isolationEnabled = isFeatureEnabled("analysis_run_isolation", { organizationId });
  const attackCenterEnabled = isFeatureEnabled("attack_simulation", { organizationId });
  const manualRecovery = query.recovery === "1";
  let analysisRunId: string | null = manualRecovery ? null : (query.run ?? null);

  const adminClient = tryCreateMissionControlAdminClient();

  if (isolationEnabled && !manualRecovery) {
    if (!adminClient) {
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
            resolveAnalysisRunForMissionControl(adminClient, {
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

  const missionControlState = await traceAwait(
    "loadFullMissionControlState",
    { ...traceCtx, analysisRunId },
    () =>
      loadFullMissionControlState(auth.supabase, {
        projectId,
        organizationId,
        admin: adminClient,
        analysisRunId,
        manualRecovery,
        openTechnicalDetails: query.technical === "open",
        onboarded: query.onboarded === "1",
        connected: query.connected === "1",
        reviewComplete: query.reviewComplete === "1",
      })
  );

  if (!missionControlState) notFound();

  const rscIssues = findNonSerializablePaths(missionControlState, {
    rootLabel: "missionControlState",
  });
  if (rscIssues.length > 0) {
    console.error({
      component: "mission-control-rsc-audit",
      event: "non_serializable_props_detected",
      projectId,
      runId: missionControlState.analysisRunId,
      issues: rscIssues,
    });
  }

  const safeMissionControlState = toRscSafe(missionControlState) as MissionControlState;

  missionControlTrace("MissionControlPage", "END", {
    ...traceCtx,
    analysisRunId: missionControlState.analysisRunId,
    hasVerdict: Boolean(missionControlState.productionVerdict),
    rscIssueCount: rscIssues.length,
  });

  const { t } = await getTranslator("missionControl");
  const showSecurityTest = shouldShowSecurityTestNav({ attackCenterEnabled });

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
          analysisRunId={
            isolationEnabled && missionControlState.runScoped
              ? missionControlState.analysisRunId ?? undefined
              : undefined
          }
          showSecurityTest={showSecurityTest}
        />

        <MissionControlExperience initialState={safeMissionControlState} />
      </div>
    </div>
  );
}
