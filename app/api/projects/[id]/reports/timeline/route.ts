import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
