import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveUserOrganizationId } from "@/server/organizations/resolve-user-organization";
import { getWorkspaceWebhookHealth } from "@/server/github/webhook-health";
import { enforceRateLimit } from "@/server/http/rate-limit";

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const organizationId = await resolveUserOrganizationId(supabase, user.id);
  if (!organizationId) {
    return NextResponse.json({ projects: [], summary: { healthy: 0, total: 0, degraded: 0 } });
  }

  const projects = await getWorkspaceWebhookHealth(supabase, organizationId);
  const healthy = projects.filter((p) => p.healthy).length;

  return NextResponse.json({
    projects,
    summary: {
      total: projects.length,
      healthy,
      degraded: projects.length - healthy,
    },
  });
}
