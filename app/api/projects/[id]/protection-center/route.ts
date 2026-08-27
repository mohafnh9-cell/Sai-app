import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getProtectionCenterModel } from "@/server/continuous-protection/protection-context";
import { cachedRead, invalidateProjectCache } from "@/server/cache/read-cache";
import { withOperationTiming } from "@/server/observability/operation-timing";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { enforceRateLimit } from "@/server/http/rate-limit";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const model = await withOperationTiming("api.protection_center", () =>
    cachedRead("protection_center_model", projectId, () =>
      getProtectionCenterModel(admin, projectId)
    )
  );

  return NextResponse.json({ projectId, protectionCenter: model });
}

/** Toggle Continuous Protection on/off for this project. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const rateLimited = await enforceRateLimit(request, {
    limit: 20,
    windowMs: 60_000,
    keyPrefix: "protection-center-toggle",
  });
  if (rateLimited) return rateLimited;

  const { id: projectId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("project_continuous_protection").upsert(
    {
      project_id: projectId,
      organization_id: access.project.organization_id,
      enabled: body.enabled,
      paused_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  );
  if (error) {
    return NextResponse.json({ error: "Could not update continuous protection" }, { status: 500 });
  }

  invalidateProjectCache(projectId, "protection_center_model");
  const model = await getProtectionCenterModel(admin, projectId);
  return NextResponse.json({ projectId, protectionCenter: model });
}
