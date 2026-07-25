import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { generateMonthlyProtectionReport } from "@/server/protection-reports/generate-monthly";
import { generateWeeklyProtectionReport } from "@/server/protection-reports/generate-weekly";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    type?: "weekly" | "monthly";
    regenerate?: boolean;
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const reportType = body.type ?? "weekly";
  const regenerate = Boolean(body.regenerate);

  const result =
    reportType === "monthly"
      ? await generateMonthlyProtectionReport(admin, projectId, { regenerate })
      : await generateWeeklyProtectionReport(admin, projectId, { regenerate });

  return NextResponse.json({ projectId, result });
}
