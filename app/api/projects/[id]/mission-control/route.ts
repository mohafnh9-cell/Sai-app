import { NextResponse } from "next/server";
import { z } from "zod";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { getProjectAccessForUser } from "@/server/projects/project-access";
import { getMissionControlView } from "@/server/mission-control/get-mission-control";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import {
  requestedAnalysisRunIdFromRequest,
  resolveAnalysisRunIdForIsolation,
} from "@/server/analysis-runs/resolve-analysis-run-id-for-isolation";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const { id: projectId } = parsed.data;
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isFeatureEnabled("mission_control", { organizationId: auth.organizationId })) {
    return NextResponse.json({ error: "Mission Control is not enabled" }, { status: 404 });
  }

  const project = await getProjectAccessForUser(auth.supabase, projectId, auth.user.id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const isolationEnabled = isFeatureEnabled("analysis_run_isolation", {
    organizationId: auth.organizationId,
  });
  const admin = createAdminClient();
  const { runId: analysisRunId, invalidRequest } = await resolveAnalysisRunIdForIsolation(admin, {
    projectId,
    organizationId: auth.organizationId,
    requestedRunId: requestedAnalysisRunIdFromRequest(request),
    isolationEnabled,
  });
  if (invalidRequest) {
    return NextResponse.json({ error: "Invalid analysis run" }, { status: 400 });
  }

  const { view, verdict } = await getMissionControlView(
    auth.supabase,
    projectId,
    auth.organizationId,
    isolationEnabled && analysisRunId ? { analysisRunId } : undefined
  );

  return NextResponse.json({ view, verdict });
}
