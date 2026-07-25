import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getProjectMemorySummary } from "@/server/production-memory/get-project-memory-summary";
import { cachedRead } from "@/server/cache/read-cache";
import { withOperationTiming } from "@/server/observability/operation-timing";
import { requireProjectApiAccess } from "@/server/projects/project-access";

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
  const summary = await withOperationTiming("api.production_memory", () =>
    cachedRead("production_memory_summary", projectId, () =>
      getProjectMemorySummary(admin, projectId)
    )
  );

  return NextResponse.json({
    projectId,
    memory: summary,
  });
}
