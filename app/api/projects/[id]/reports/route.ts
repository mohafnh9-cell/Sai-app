import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { listReportHistory } from "@/server/protection-reports/storage";
import type { ReportType } from "@/server/protection-reports/types";
import { requireProjectApiAccess } from "@/server/projects/project-access";

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

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const reports = await listReportHistory(admin, projectId, reportType as ReportType | undefined, 24);

  return NextResponse.json({ projectId, reports });
}
