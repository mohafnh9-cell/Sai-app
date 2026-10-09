import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n/server";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { isFeatureEnabled } from "@/server/feature-flags";
import { getProductionJourneyByProject } from "@/server/production-journey/service";
import { ProjectWorkflowNav } from "@/features/mission-control/components/ProjectWorkflowNav";
import { shouldShowSecurityTestNav } from "@/features/mission-control/lib/navigation";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";
import { ProductionJourneyView } from "@/features/production-journey/components/ProductionJourneyView";
import { appendAnalysisRunSearchParams } from "@/features/analysis-runs/lib/build-run-query";
import { resolveAnalysisRunForProject } from "@/server/analysis-runs/resolve-analysis-run";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { newerScanAwaitingVerdict } from "@/server/production-verdict/pending-verdict";
import type { Metadata } from "next";
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

interface JourneyPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator("productionJourney");
  return { title: t("title") };
}

export default async function ProjectJourneyPage({ params, searchParams }: JourneyPageProps) {
  const { id: rawProjectId } = await params;
  const projectId = parseRouteUuid(rawProjectId);
  if (!projectId) notFound();

  const query = await searchParams;
  let requestedRunId: string | undefined;
  if (query.run !== undefined) {
    const parsedRunId = parseRouteUuid(query.run);
    if (!parsedRunId) {
      redirect(`/projects/${projectId}/journey`);
    }
    requestedRunId = parsedRunId;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const auth = await getCachedServerAuthContext();
  const missionControlEnabled = Boolean(
    auth?.organizationId &&
      isFeatureEnabled("mission_control", { organizationId: auth.organizationId })
  );
  const attackCenterEnabled = Boolean(
    auth?.organizationId &&
      isFeatureEnabled("attack_simulation", { organizationId: auth.organizationId })
  );
  const isolationEnabled = Boolean(
    auth?.organizationId &&
      isFeatureEnabled("analysis_run_isolation", { organizationId: auth.organizationId })
  );

  let analysisRunId: string | null = requestedRunId ?? null;

  if (isolationEnabled && auth?.organizationId) {
    const admin = createAdminClient();
    const resolved = await resolveAnalysisRunForProject(admin, {
      projectId,
      organizationId: auth.organizationId,
      requestedRunId,
    });

    if (requestedRunId && !resolved.valid) {
      redirect(`/projects/${projectId}/journey`);
    }

    if (!requestedRunId && resolved.runId) {
      redirect(hrefWithAnalysisRun(`/projects/${projectId}/journey`, resolved.runId));
    }

    analysisRunId = resolved.runId;
  }

  const { t: tp } = await getTranslator("projects");
  const { t: tm } = await getTranslator("missionControl");
  const { t } = await getTranslator("productionJourney");

  // Dashboard pages are scoped ACTIVE WORKSPACE -> PROJECT -> DATA: explicit organization_id filter, not just RLS
  // (same pattern as projects/[id]/page.tsx, mission-control, attack-center and scans). A project of another
  // workspace the user belongs to must not render while that workspace is not active. Without an active workspace
  // no project can be resolved (a user with no workspace has no RLS-visible project either).
  if (!auth?.organizationId) notFound();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();

  if (!project) notFound();

  const journey = await getProductionJourneyByProject(supabase, projectId, user.id).catch(() => null);

  // While a review runs there is no final decision for the current run: the journey must not present the
  // previous verdict's posture as current (read-only; stale-review recovery stays with Mission Control).
  // The same holds once the newest scan has completed but its own verdict is not persisted yet.
  const workspaceId = auth.organizationId;
  const reviewInProgress = await (async () => {
    try {
      const admin = createAdminClient();
      const state = await getProductionReviewState(admin, {
        organizationId: workspaceId,
        projectId,
        recoverStale: false,
      });
      if (state.hasActiveReview) return true;
      const current = await getCurrentProductionVerdict(admin, workspaceId, projectId);
      return current ? await newerScanAwaitingVerdict(admin, projectId, current.scanId) : false;
    } catch {
      return false;
    }
  })();

  const { data: latestScan } = await supabase
    .from("scans")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestReportHref = latestScan?.id
    ? `/projects/${projectId}/scans/${latestScan.id}/report`
    : undefined;

  const backHref = hrefWithAnalysisRun(
    projectVerdictHref(projectId),
    isolationEnabled ? analysisRunId : undefined
  );
  const backLabel = tm("page.backToMissionControl");

  const showSecurityTest = shouldShowSecurityTestNav({ attackCenterEnabled });

  return (
    <div className={missionControlEnabled ? "app-shell-bg min-h-full" : "p-6 space-y-6 max-w-6xl"}>
      <div className={missionControlEnabled ? "mx-auto max-w-6xl px-4 sm:px-8 pb-24 pt-6 sm:pt-10 space-y-6" : "space-y-6"}>
        <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-1">
          <Link href={backHref}>
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </Button>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>

        <ProjectWorkflowNav
          projectId={projectId}
          analysisRunId={isolationEnabled ? analysisRunId : undefined}
          showSecurityTest={missionControlEnabled ? showSecurityTest : false}
        />

        {journey ? (
          <ProductionJourneyView
            journey={journey}
            projectId={projectId}
            analysisRunLinksEnabled={isolationEnabled}
            reviewInProgress={reviewInProgress}
          />
        ) : (
          <p className="text-sm text-destructive">{t("loadFailed")}</p>
        )}
      </div>
    </div>
  );
}
