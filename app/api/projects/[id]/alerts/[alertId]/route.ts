import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { acknowledgeAlert, dismissAlert, markAlertRead } from "@/server/security-alerts/lifecycle";
import { requireProjectApiAccess } from "@/server/projects/project-access";

const paramsSchema = z.object({
  id: z.string().uuid(),
  alertId: z.string().uuid(),
});

const bodySchema = z.object({
  action: z.enum(["dismiss", "read", "acknowledge"]).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; alertId: string }> }
) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid project or alert id" }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id: projectId, alertId } = parsedParams.data;
  const { action: requestedAction } = parsedBody.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const { data: alert } = await admin
    .from("security_alerts")
    .select("id, project_id, organization_id")
    .eq("id", alertId)
    .maybeSingle();

  if (
    !alert ||
    alert.project_id !== projectId ||
    alert.organization_id !== access.project.organization_id
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const action = requestedAction ?? "acknowledge";

  if (action === "dismiss") {
    await dismissAlert(admin, alertId, access.userId);
  } else if (action === "read") {
    await markAlertRead(admin, alertId, access.userId);
  } else {
    await acknowledgeAlert(admin, alertId, access.userId);
  }

  return NextResponse.json({ ok: true });
}
