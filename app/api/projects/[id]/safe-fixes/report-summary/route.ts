import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { summarizeSafeFixImpact } from "@/server/safe-fix-engine/memory-bridge";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await context.params;
  const url = new URL(request.url);
  const periodStart = url.searchParams.get("periodStart");
  const periodEnd = url.searchParams.get("periodEnd");
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: "periodStart and periodEnd required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const summary = await summarizeSafeFixImpact(admin, projectId, periodStart, periodEnd);
  return NextResponse.json({ projectId, periodStart, periodEnd, safeFixSummary: summary });
}
