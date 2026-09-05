import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AttackCenterExperience } from "@/features/attack-simulation/AttackCenterExperience";
import { AttackSimulationIntro } from "@/features/attack-simulation/components/AttackSimulationIntro";
import {
  ProjectWorkflowNav,
} from "@/features/mission-control/components/ProjectWorkflowNav";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { isFeatureEnabled } from "@/server/feature-flags";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { loadAttackCenterListState } from "@/server/attack-simulation/api/load-attack-center-list";
import { buildAttackCenterCapability } from "@/server/attack-simulation/api/attack-center-contract";
import { attackCenterErrorFromUnknown } from "@/server/attack-simulation/api/errors";
import { getAttackCampaignByScanId } from "@/server/attack-simulation/persistence/campaign-repository";
import { getDynamicTargetAuthorizationStatus } from "@/server/ai-red-team/authorization/dynamic-target-authorization-service";
import { isDynamicTargetVerificationBypassEnabled } from "@/lib/security/dynamic-target-verification-bypass";
import { isAnalysisRunOwnedByProject } from "@/server/analysis-runs/get-analysis-run-snapshot";
import { resolveAnalysisRunForMissionControl } from "@/server/analysis-runs/resolve-analysis-run";
import { appendAnalysisRunSearchParams } from "@/features/analysis-runs/lib/build-run-query";
import type { AttackCenterCapability } from "@/features/attack-simulation/api-types";
import type { AttackCenterSnapshot } from "@/server/attack-simulation/ui/types";
import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";
import { z } from "zod";

const routeUuidSchema = z.string().uuid();

function parseRouteUuid(value: string): string | null {
  const parsed = routeUuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function hrefWithAnalysisRun(href: string, analysisRunId?: string | null): string {
  if (!analysisRunId) return href;
  const params = new URLSearchParams();
  appendAnalysisRunSearchParams(params, analysisRunId);
  const qs = params.toString();
  return qs ? `${href}?${qs}` : href;
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const projectId = parseRouteUuid(id);
  const { t } = await getTranslator("attackCenter");
  if (!projectId) return { title: t("page.title") };
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) return { title: t("page.title") };
  // Explicit organization_id filter, not just RLS -- auth.supabase can be an
  // admin (RLS-bypassing) client under SEQURAI_BYPASS_AUTH dev mode (see the
  // matching fix in mission-control/page.tsx, found during the Phase 12
  // cross-tenant audit).
  const { data } = await auth.supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  return { title: data?.name ? `${data.name} — ${t("page.title")}` : t("page.title") };
}

export default async function AttackCenterPage({ params, searchParams }: PageProps) {
  const { id: rawProjectId } = await params;
  const projectId = parseRouteUuid(rawProjectId);
  if (!projectId) notFound();

  const query = await searchParams;
  let requestedRunId: string | undefined;
  if (query.run !== undefined) {
    const parsedRunId = parseRouteUuid(query.run);
    if (!parsedRunId) {
      redirect(`/projects/${projectId}/attack-center`);
    }
    requestedRunId = parsedRunId;
  }

  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) redirect("/login");

  if (!isFeatureEnabled("attack_simulation", { organizationId: auth.organizationId })) {
    redirect(`/projects/${projectId}/mission-control`);
  }

  const isolationEnabled = isFeatureEnabled("analysis_run_isolation", {
    organizationId: auth.organizationId,
  });

  let analysisRunId: string | null = requestedRunId ?? null;

  if (isolationEnabled) {
    const admin = createAdminClient();
    const resolved = await resolveAnalysisRunForMissionControl(admin, {
      projectId,
      organizationId: auth.organizationId,
      requestedRunId,
    });

    if (requestedRunId && !resolved.valid) {
      redirect(`/projects/${projectId}/attack-center`);
    }

    if (!requestedRunId && resolved.runId) {
      redirect(hrefWithAnalysisRun(`/projects/${projectId}/attack-center`, resolved.runId));
    }

    analysisRunId = resolved.runId;
  } else if (requestedRunId) {
    const admin = createAdminClient();
    const owned = await isAnalysisRunOwnedByProject(admin, {
      projectId,
      organizationId: auth.organizationId,
      runId: requestedRunId,
    });
    if (!owned) {
      redirect(`/projects/${projectId}/attack-center`);
    }
  }

  // Explicit organization_id filter, not just RLS -- see the generateMetadata
  // fix above and load-full-mission-control-state.ts for the same
  // cross-tenant leak pattern found during the Phase 12 audit.
  const { data: project } = await auth.supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();

  if (!project) notFound();

  const admin = createAdminClient();
  let initialSnapshot: AttackCenterSnapshot | null = null;
  let initialCapability: AttackCenterCapability | null = buildAttackCenterCapability({
    organizationId: auth.organizationId,
  });
  let initialCampaignId: string | null = null;

  if (isolationEnabled && analysisRunId) {
    const runCampaign = await getAttackCampaignByScanId(admin, analysisRunId, auth.organizationId);
    initialCampaignId = runCampaign?.id ?? null;
  }

  try {
    const initialState = await loadAttackCenterListState(admin, {
      projectId,
      organizationId: auth.organizationId,
      analysisRunId: isolationEnabled ? analysisRunId : undefined,
    });
    initialSnapshot = initialState.activeCampaign;
    initialCapability = initialState.capability;
  } catch (error) {
    const mapped = attackCenterErrorFromUnknown(error);
    console.error({
      component: "attack-center-page",
      event: "initial_load_failed",
      projectId,
      code: mapped.code,
      message: mapped.message,
    });
  }

  const { t: ta } = await getTranslator("attackCenter");
  const dynamicTargetAuthorizationStatus = isFeatureEnabled("attack_simulation", {
    organizationId: auth.organizationId,
  })
    ? await getDynamicTargetAuthorizationStatus(admin, {
        organizationId: auth.organizationId,
        projectId,
      })
    : null;
  const skipTargetVerification = isDynamicTargetVerificationBypassEnabled(auth.user.email);
  const missionControlHref = hrefWithAnalysisRun(
    `/projects/${projectId}/mission-control`,
    isolationEnabled ? analysisRunId : undefined
  );

  return (
    <div className="app-shell-bg min-h-full">
      <div className="mx-auto max-w-6xl px-4 sm:px-8 pb-24 pt-6 sm:pt-10">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 text-muted-foreground mb-8">
          <Link href={missionControlHref}>
            <ArrowLeft className="h-4 w-4" />
            {ta("page.backToMissionControl")}
          </Link>
        </Button>
        <ProjectWorkflowNav
          projectId={projectId}
          analysisRunId={isolationEnabled ? analysisRunId : undefined}
          showSecurityTest
        />
        <AttackSimulationIntro />
        <AttackCenterExperience
          projectId={projectId}
          initialSnapshot={initialSnapshot}
          initialCapability={initialCapability}
          initialCampaignId={
            initialCampaignId ??
            (initialSnapshot?.kind === "campaign" ? initialSnapshot.campaign.id : null)
          }
          analysisRunId={isolationEnabled ? analysisRunId : undefined}
          dynamicTargetAuthorizationStatus={dynamicTargetAuthorizationStatus}
          skipTargetVerification={skipTargetVerification}
        />
      </div>
    </div>
  );
}
