import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { generateMonthlyProtectionReport } from "@/server/protection-reports/generate-monthly";
import { generateWeeklyProtectionReport } from "@/server/protection-reports/generate-weekly";
import { requireProjectApiAccess } from "@/server/projects/project-access";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z.object({
  type: z.enum(["weekly", "monthly"]).optional(),
  regenerate: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id: projectId } = parsedParams.data;
  const { type: reportType = "weekly", regenerate = false } = parsedBody.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();

  const result =
    reportType === "monthly"
      ? await generateMonthlyProtectionReport(admin, projectId, { regenerate })
      : await generateWeeklyProtectionReport(admin, projectId, { regenerate });

  return NextResponse.json({ projectId, result });
}
