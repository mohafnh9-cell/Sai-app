import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { listReportHistory } from "@/server/protection-reports/storage";
import type { ReportType } from "@/server/protection-reports/types";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await context.params;
  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const reportType = typeParam === "weekly" || typeParam === "monthly" ? typeParam : undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const reports = await listReportHistory(admin, projectId, reportType as ReportType | undefined, 24);

  return NextResponse.json({ projectId, reports });
}
