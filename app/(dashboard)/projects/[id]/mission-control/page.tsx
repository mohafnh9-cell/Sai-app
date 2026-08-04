import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MissionControlExperience } from "@/features/mission-control/components/MissionControlExperience";
import { MissionControlSubNav } from "@/features/mission-control/components/MissionControlSubNav";
import { ProjectOnboardedBanner } from "@/features/projects/components/ProjectOnboardedBanner";
import { getMissionControlView } from "@/server/mission-control/get-mission-control";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { isFeatureEnabled } from "@/server/feature-flags";
import { fixPromptContextFromScan } from "@/features/production-verdict/fix-prompt-context";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { getSecurityTestContext } from "@/server/attack-simulation/get-security-test-context";
import type { SecurityTestContext } from "@/features/security-testing/types";
import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connected?: string; reviewComplete?: string; onboarded?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getTranslator("missionControl");
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) return { title: t("page.title") };
  const { data } = await auth.supabase.from("projects").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ? `${data.name} — ${t("page.title")}` : t("page.title") };
}

export default async function MissionControlPage({ params, searchParams }: PageProps) {
  const { id: projectId } = await params;
  const query = await searchParams;
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) redirect("/login");

  if (!isFeatureEnabled("mission_control", { organizationId: auth.organizationId })) {
    redirect(`/projects/${projectId}`);
  }

  const attackCenterEnabled = isFeatureEnabled("attack_simulation", {
    organizationId: auth.organizationId,
  });

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id, name, framework")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) notFound();

  const reviewContext = await getProjectReviewUiContext(auth.supabase, projectId);

  const { view, verdict } = await getMissionControlView(
    auth.supabase,
    projectId,
    auth.organizationId
  );

  const { data: latestScan } = await auth.supabase
    .from("scans")
    .select("id, detected_stack")
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestReportHref = latestScan?.id
    ? `/projects/${projectId}/scans/${latestScan.id}/report`
    : undefined;

  const fixPromptContext = verdict
    ? fixPromptContextFromScan({
        projectName: project.name,
        detectedStack: latestScan?.detected_stack,
        framework: project.framework,
        currentVerdictStatus: verdict.status,
        currentScore: verdict.score,
      })
    : undefined;

  let securityTestContext: SecurityTestContext | null = null;

  if (attackCenterEnabled && reviewContext) {
    try {
      const admin = createAdminClient();
      const fullContext = await getSecurityTestContext(admin, {
        projectId,
        organizationId: auth.organizationId,
      });
      const { hypotheses: _hypotheses, ...publicContext } = fullContext;
      securityTestContext = publicContext;
    } catch {
      securityTestContext = null;
    }
  }

  const { t } = await getTranslator("missionControl");
  const { t: tp } = await getTranslator("projects");

  return (
    <div className="app-cinematic-bg min-h-full">
      <div className="mx-auto max-w-4xl px-4 sm:px-8 pb-24 pt-6 sm:pt-10">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 text-muted-foreground mb-8">
          <Link href="/projects">
            <ArrowLeft className="h-4 w-4" />
            {t("page.backToProjects")}
          </Link>
        </Button>
        <MissionControlSubNav
          projectId={projectId}
          latestReportHref={latestReportHref}
          attackCenterEnabled={attackCenterEnabled}
        />

        {query.onboarded === "1" && verdict ? (
          <ProjectOnboardedBanner readyToShip={verdict.status === "ready_to_ship"} />
        ) : null}

        {query.connected === "1" ? (
          <div className="surface-premium rounded-2xl p-5 mb-8">
            <p className="text-sm font-medium">{tp("connectedGuidanceTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{tp("connectedGuidanceBody")}</p>
          </div>
        ) : null}

        {query.reviewComplete === "1" && verdict ? (
          <div className="surface-premium rounded-2xl p-5 mb-8">
            <p className="text-sm font-medium">{tp("reviewCompleteGuidanceTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{tp("reviewCompleteGuidanceBody")}</p>
          </div>
        ) : null}

        {reviewContext?.isStale ? (
          <div className="rounded-2xl border border-brand-warning/30 bg-brand-warning/5 px-5 py-4 text-sm text-foreground/90 mb-8">
            {tp("latestCommitNotReviewedBanner")}
          </div>
        ) : null}

        <MissionControlExperience
          view={view}
          verdict={verdict}
          projectName={project.name}
          fixPromptContext={fixPromptContext}
          securityTestContext={securityTestContext}
          reviewContext={reviewContext}
        />
      </div>
    </div>
  );
}
