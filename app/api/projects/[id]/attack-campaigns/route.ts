import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import {
  StartAttackCampaignError,
  startAttackCampaign,
} from "@/server/attack-simulation/start-attack-campaign";
import { getAttackCenterCampaignSnapshot } from "@/server/attack-simulation/get-attack-center";
import {
  buildAttackCenterDisabledResponse,
  buildAttackCenterCapability,
} from "@/server/attack-simulation/api/attack-center-contract";
import { attackCenterErrorResponse } from "@/server/attack-simulation/api/errors";
import { loadAttackCenterListState } from "@/server/attack-simulation/api/load-attack-center-list";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const organizationId = access.project.organization_id;

  if (!isFeatureEnabled("attack_simulation", { organizationId })) {
    return NextResponse.json(
      buildAttackCenterDisabledResponse({ organizationId }),
      { status: 200 }
    );
  }

  try {
    const admin = createAdminClient();
    const isolationEnabled = isFeatureEnabled("analysis_run_isolation", { organizationId });
    const { runId: analysisRunId, invalidRequest } = await resolveAnalysisRunIdForIsolation(
      admin,
      {
        projectId,
        organizationId,
        requestedRunId: requestedAnalysisRunIdFromRequest(request),
        isolationEnabled,
      }
    );
    if (invalidRequest) {
      return NextResponse.json({ error: "Invalid analysis run" }, { status: 400 });
    }
    const body = await loadAttackCenterListState(admin, {
      projectId,
      organizationId,
      analysisRunId: isolationEnabled ? analysisRunId : undefined,
    });
    return NextResponse.json(body);
  } catch (error) {
    console.error({
      component: "attack-campaigns-api",
      event: "list_failed",
      projectId,
      organizationId,
      errorType: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    return attackCenterErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const { id: projectId } = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  if (!isFeatureEnabled("attack_simulation", { organizationId: access.project.organization_id })) {
    return NextResponse.json(
      {
        ok: false,
        error: "Attack Simulation is not enabled for this organization.",
        capability: buildAttackCenterCapability({
          organizationId: access.project.organization_id,
        }),
      },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const admin = createAdminClient();

  try {
    const result = await startAttackCampaign(admin, {
      projectId,
      organizationId: access.project.organization_id,
      body,
    });

    const snapshot = await getAttackCenterCampaignSnapshot(admin, {
      projectId,
      organizationId: access.project.organization_id,
      campaignId: result.campaignId,
    });

    return NextResponse.json({ ...result, snapshot }, { status: 201 });
  } catch (error) {
    if (error instanceof StartAttackCampaignError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error({
      component: "attack-campaigns-api",
      event: "create_failed",
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return attackCenterErrorResponse(error);
  }
}
