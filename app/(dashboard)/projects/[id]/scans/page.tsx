import { redirect, notFound } from "next/navigation";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

/** Legacy scan list — redirect to Production Verdict (project home). */
export default async function ScanHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await getCachedServerAuthContext();
  if (!auth) redirect("/login");

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  if (!project) notFound();

  redirect(projectVerdictHref(id, { technical: "open" }));
}
