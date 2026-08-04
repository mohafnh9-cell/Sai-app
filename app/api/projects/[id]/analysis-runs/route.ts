import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { listAnalysisRunsForProject } from "@/server/analysis-runs/list-analysis-runs";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const projectId = parsed.data.id;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  if (
    !isFeatureEnabled("analysis_run_isolation", {
      organizationId: access.project.organization_id,
    })
  ) {
    return NextResponse.json({ error: "Analysis run isolation is not enabled" }, { status: 404 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 12, 1), 50) : 12;

  try {
    const admin = createAdminClient();
    const runs = await listAnalysisRunsForProject(admin, {
      projectId,
      organizationId: access.project.organization_id,
      limit,
    });
    return NextResponse.json({ ok: true, runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list analysis runs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
