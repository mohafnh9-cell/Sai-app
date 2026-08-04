import { redirect, notFound } from "next/navigation";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

/** Legacy scan detail — redirect to Production Verdict. */
export default async function ScanDetailPage({
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
    .maybeSingle();
  if (!project) notFound();

  redirect(projectVerdictHref(projectId));
}
