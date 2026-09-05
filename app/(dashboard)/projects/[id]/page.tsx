import { redirect, notFound } from "next/navigation";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connected?: string; reviewComplete?: string; onboarded?: string }>;
}

/** Legacy overview URL — redirect to Production Verdict when Mission Control is enabled. */
export default async function ProjectDetailPage({
  params,
  searchParams,
}: ProjectDetailPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) redirect("/login");

  // Explicit organization_id filter, not just RLS (Phase 12 audit finding).
  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();

  if (!project) notFound();

  redirect(
    projectVerdictHref(id, {
      onboarded: query.onboarded,
      connected: query.connected,
      reviewComplete: query.reviewComplete,
    })
  );
}
