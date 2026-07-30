import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MissionControlExperience } from "@/features/mission-control/components/MissionControlExperience";
import { MissionControlSubNav } from "@/features/mission-control/components/MissionControlSubNav";
import { getMissionControlView } from "@/server/mission-control/get-mission-control";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { isFeatureEnabled } from "@/server/feature-flags";
import { fixPromptContextFromScan } from "@/features/production-verdict/fix-prompt-context";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { getSecurityTestContext } from "@/server/attack-simulation/get-security-test-context";
import type { SecurityTestContext } from "@/features/security-testing/types";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) return { title: "Mission Control" };
  const { data } = await auth.supabase.from("projects").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ? `${data.name} — Mission Control` : "Mission Control" };
}

export default async function MissionControlPage({ params }: PageProps) {
  const { id: projectId } = await params;
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

  const { view, verdict } = await getMissionControlView(
    auth.supabase,
    projectId,
    auth.organizationId
  );

  const latestScan = await auth.supabase
    .from("scans")
    .select("detected_stack")
    .eq("project_id", projectId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fixPromptContext = verdict
    ? fixPromptContextFromScan({
        projectName: project.name,
        detectedStack: latestScan.data?.detected_stack,
        framework: project.framework,
        currentVerdictStatus: verdict.status,
        currentScore: verdict.score,
      })
    : undefined;

  let securityTestContext: SecurityTestContext | null = null;
  let reviewContext = null;

  if (attackCenterEnabled) {
    reviewContext = await getProjectReviewUiContext(auth.supabase, projectId);
    if (reviewContext) {
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
  }

  return (
    <div className="app-cinematic-bg min-h-full">
      <div className="mx-auto max-w-4xl px-4 sm:px-8 pb-24 pt-6 sm:pt-10">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 text-muted-foreground mb-8">
          <Link href="/projects">
            <ArrowLeft className="h-4 w-4" />
            Projects
          </Link>
        </Button>
        {attackCenterEnabled ? <MissionControlSubNav projectId={projectId} /> : null}
        <MissionControlExperience
          view={view}
          verdict={verdict}
          fixPromptContext={fixPromptContext}
          securityTestContext={securityTestContext}
          reviewContext={reviewContext}
        />
      </div>
    </div>
  );
}
