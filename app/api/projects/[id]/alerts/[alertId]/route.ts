import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { acknowledgeAlert, dismissAlert, markAlertRead } from "@/server/security-alerts/lifecycle";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; alertId: string }> }
) {
  const { id: projectId, alertId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { action?: string };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const action = body.action ?? "acknowledge";

  if (action === "dismiss") {
    await dismissAlert(admin, alertId, user.id);
  } else if (action === "read") {
    await markAlertRead(admin, alertId, user.id);
  } else {
    await acknowledgeAlert(admin, alertId, user.id);
  }

  return NextResponse.json({ ok: true });
}
