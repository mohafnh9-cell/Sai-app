import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const { data } = await admin
    .from("protection_timeline_entries")
    .select("*")
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .limit(40);

  return NextResponse.json({
    projectId,
    timeline: (data ?? []).map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      episodeKind: row.episode_kind,
      periodKey: row.period_key,
      icon: row.icon,
      titlePlain: row.title_plain,
      subtitlePlain: row.subtitle_plain,
      payload: row.payload,
    })),
  });
}
