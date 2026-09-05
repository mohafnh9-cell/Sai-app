import { redirect, notFound } from "next/navigation";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

/** Legacy technical report — redirect to Production Verdict technical disclosure. */
export default async function ProductionReportPage({
  params,
}: {
  params: Promise<{ id: string; scanId: string }>;
}) {
  const { id: projectId } = await params;
  const auth = await getCachedServerAuthContext();
  if (!auth) redirect("/login");

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  if (!project) notFound();

  redirect(projectVerdictHref(projectId, { technical: "open" }));
}
