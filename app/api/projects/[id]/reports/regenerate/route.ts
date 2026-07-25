import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { generateMonthlyProtectionReport } from "@/server/protection-reports/generate-monthly";
import { generateWeeklyProtectionReport } from "@/server/protection-reports/generate-weekly";
import { requireProjectApiAccess } from "@/server/projects/project-access";

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

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const reportType = body.type ?? "weekly";
  const regenerate = Boolean(body.regenerate);

  const result =
    reportType === "monthly"
      ? await generateMonthlyProtectionReport(admin, projectId, { regenerate })
      : await generateWeeklyProtectionReport(admin, projectId, { regenerate });

  return NextResponse.json({ projectId, result });
}
