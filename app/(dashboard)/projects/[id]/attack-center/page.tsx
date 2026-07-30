import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AttackCenterExperience } from "@/features/attack-simulation/AttackCenterExperience";
import { MissionControlSubNav } from "@/features/mission-control/components/MissionControlSubNav";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { isFeatureEnabled } from "@/server/feature-flags";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getLatestAttackCenterCampaignForProject } from "@/server/attack-simulation/get-attack-center";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) return { title: "Attack Center" };
  const { data } = await auth.supabase.from("projects").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ? `${data.name} — Attack Center` : "Attack Center" };
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

  const admin = createAdminClient();
  const initialSnapshot = await getLatestAttackCenterCampaignForProject(admin, {
    projectId,
    organizationId: auth.organizationId,
  });

  return (
    <div className="app-cinematic-bg min-h-full">
      <div className="mx-auto max-w-4xl px-4 sm:px-8 pb-24 pt-6 sm:pt-10">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 text-muted-foreground mb-8">
          <Link href={`/projects/${projectId}/mission-control`}>
            <ArrowLeft className="h-4 w-4" />
            Mission Control
          </Link>
        </Button>
        <MissionControlSubNav projectId={projectId} />
        <AttackCenterExperience
          projectId={projectId}
          initialSnapshot={initialSnapshot}
          initialCampaignId={
            initialSnapshot?.kind === "campaign" ? initialSnapshot.campaign.id : null
          }
        />
      </div>
    </div>
  );
}
