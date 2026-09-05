import { redirect, notFound } from "next/navigation";
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
import { getProductionIntelligence } from "@/server/production-intelligence/get-production-intelligence";
import { getProductionJourneyByProject } from "@/server/production-journey/get-production-journey";

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
  // Explicit organization_id filter, not just RLS -- see the matching fix in
  // loadFullMissionControlState (same cross-tenant leak, this file's other
  // unguarded project lookup, found during the Phase 12 audit).
  const { data } = await auth.supabase
    .from("projects")
    .select("name")
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
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

  const safeMissionControlState = toRscSafe(missionControlState) as MissionControlState;

  if (process.env.NODE_ENV === "development") {
    const rscIssues = findNonSerializablePaths(safeMissionControlState, {
      rootLabel: "missionControlState",
    });
    if (rscIssues.length > 0) {
      console.warn("[mission-control] non-serializable props after sanitization", {
        projectId,
        runId: safeMissionControlState.analysisRunId,
        issues: rscIssues,
      });
    }
  }

  missionControlTrace("MissionControlPage", "END", {
    ...traceCtx,
    analysisRunId: missionControlState.analysisRunId,
    hasVerdict: Boolean(missionControlState.productionVerdict),
  });

  const [productionIntelligence, journey] = await Promise.all([
    getProductionIntelligence(auth.supabase, projectId, auth.user.id).catch(() => null),
    getProductionJourneyByProject(auth.supabase, projectId, auth.user.id, { limit: 50 }).catch(
      () => null
    ),
  ]);

  const showSecurityTest = shouldShowSecurityTestNav({ attackCenterEnabled });

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-6xl px-4 sm:px-8 pb-24 pt-6 sm:pt-8">
        <ProjectWorkflowNav
          projectId={projectId}
          analysisRunId={
            isolationEnabled && missionControlState.runScoped
              ? missionControlState.analysisRunId ?? undefined
              : undefined
          }
          showSecurityTest={showSecurityTest}
        />

        <MissionControlExperience
          initialState={safeMissionControlState}
          productionIntelligence={productionIntelligence}
          areasProgress={journey?.areasProgress ?? []}
        />
      </div>
    </div>
  );
}
