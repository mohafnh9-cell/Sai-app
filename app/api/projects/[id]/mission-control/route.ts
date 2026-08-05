import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import {
  requestedAnalysisRunIdFromRequest,
  resolveAnalysisRunIdForIsolation,
} from "@/server/analysis-runs/resolve-analysis-run-id-for-isolation";
import { loadFullMissionControlState } from "@/server/mission-control/load-full-mission-control-state";
import { toRscSafe } from "@/lib/rsc/to-rsc-safe";

const paramsSchema = z.object({ id: z.string().uuid() });

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  const organizationId = access.project.organization_id;
  const isolationEnabled = isFeatureEnabled("analysis_run_isolation", { organizationId });

  let admin = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }

  const { runId: analysisRunId, invalidRequest } = admin
    ? await resolveAnalysisRunIdForIsolation(admin, {
        projectId,
        organizationId,
        requestedRunId: requestedAnalysisRunIdFromRequest(request),
        isolationEnabled,
      })
    : { runId: null, invalidRequest: false };

  if (invalidRequest) {
    return NextResponse.json({ error: "Invalid analysis run" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const manualRecovery = searchParams.get("recovery") === "1";

  const state = await loadFullMissionControlState(supabase, {
    projectId,
    organizationId,
    admin,
    analysisRunId,
    manualRecovery,
    openTechnicalDetails: searchParams.get("technical") === "open",
    onboarded: searchParams.get("onboarded") === "1",
    connected: searchParams.get("connected") === "1",
    reviewComplete: searchParams.get("reviewComplete") === "1",
  });

  if (!state) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(toRscSafe({ ok: true, ...state }), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
