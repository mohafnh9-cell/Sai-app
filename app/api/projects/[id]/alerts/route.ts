import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getOpenAlertsForProject } from "@/server/security-alerts/evaluate-project";
import { mapAlertRow } from "@/server/security-alerts/lifecycle";
import { sortAlertsByPriority } from "@/server/security-alerts/noise-policy";
import { severityProfile } from "@/server/security-alerts/severity";

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

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const rows = await getOpenAlertsForProject(admin, projectId, 20);
  const alerts = sortAlertsByPriority(
    rows.map(mapAlertRow).map((a) => ({ ...a, priority: severityProfile(a.severity).priority }))
  );

  return NextResponse.json({ projectId, alerts });
}
