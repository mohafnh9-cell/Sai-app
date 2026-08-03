import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AttackCenterExperience } from "@/features/attack-simulation/AttackCenterExperience";
import { MissionControlSubNav } from "@/features/mission-control/components/MissionControlSubNav";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { isFeatureEnabled } from "@/server/feature-flags";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { loadAttackCenterListState } from "@/server/attack-simulation/api/load-attack-center-list";
import { buildAttackCenterCapability } from "@/server/attack-simulation/api/attack-center-contract";
import { attackCenterErrorFromUnknown } from "@/server/attack-simulation/api/errors";
import { getSecurityTestContext } from "@/server/attack-simulation/get-security-test-context";
import type { AttackCenterCapability } from "@/features/attack-simulation/api-types";
import type { SecurityTestContext } from "@/features/security-testing/types";
import type { AttackCenterSnapshot } from "@/server/attack-simulation/ui/types";
import type { Metadata } from "next";
import { getTranslator } from "@/lib/i18n/server";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getTranslator("attackCenter");
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) return { title: t("page.title") };
  const { data } = await auth.supabase.from("projects").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ? `${data.name} — ${t("page.title")}` : t("page.title") };
}

export default async function AttackCenterPage({ params }: PageProps) {
  const { id: projectId } = await params;
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) redirect("/login");

  if (!isFeatureEnabled("attack_simulation", { organizationId: auth.organizationId })) {
    redirect(`/projects/${projectId}/mission-control`);
  }

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) notFound();

  const reviewContext = await getProjectReviewUiContext(auth.supabase, projectId);
  if (!reviewContext) notFound();

  const admin = createAdminClient();
  let initialSnapshot: AttackCenterSnapshot | null = null;
  let initialCapability: AttackCenterCapability | null = buildAttackCenterCapability({
    organizationId: auth.organizationId,
  });
  let securityTestContext: SecurityTestContext | null = null;

  try {
    const initialState = await loadAttackCenterListState(admin, {
      projectId,
      organizationId: auth.organizationId,
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

  try {
    const fullContext = await getSecurityTestContext(admin, {
      projectId,
      organizationId: auth.organizationId,
    });
    const { hypotheses: _hypotheses, ...publicContext } = fullContext;
    securityTestContext = publicContext;
  } catch {
    securityTestContext = null;
  }

  const { t: ta } = await getTranslator("attackCenter");

  return (
    <div className="app-cinematic-bg min-h-full">
      <div className="mx-auto max-w-4xl px-4 sm:px-8 pb-24 pt-6 sm:pt-10">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 text-muted-foreground mb-8">
          <Link href={`/projects/${projectId}/mission-control`}>
            <ArrowLeft className="h-4 w-4" />
            {ta("page.backToMissionControl")}
          </Link>
        </Button>
        <MissionControlSubNav projectId={projectId} />
        <AttackCenterExperience
          projectId={projectId}
          initialSnapshot={initialSnapshot}
          initialCapability={initialCapability}
          reviewContext={reviewContext}
          securityTestContext={securityTestContext}
          initialCampaignId={
            initialSnapshot?.kind === "campaign" ? initialSnapshot.campaign.id : null
          }
        />
      </div>
    </div>
  );
}
