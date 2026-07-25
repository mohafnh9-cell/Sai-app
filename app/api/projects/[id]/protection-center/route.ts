import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getProtectionCenterModel } from "@/server/continuous-protection/protection-context";
import { cachedRead } from "@/server/cache/read-cache";
import { withOperationTiming } from "@/server/observability/operation-timing";
import { requireProjectApiAccess } from "@/server/projects/project-access";

/** Backend Protection Center model (Sprint 4 — no UI). */
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
