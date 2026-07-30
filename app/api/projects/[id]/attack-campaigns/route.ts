import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { listAttackCampaignsForProject } from "@/server/attack-simulation/persistence/campaign-repository";
import {
  getLatestAttackCenterCampaignForProject,
  getAttackCenterCampaignSnapshot,
} from "@/server/attack-simulation/get-attack-center";
import {
  StartAttackCampaignError,
  startAttackCampaign,
} from "@/server/attack-simulation/start-attack-campaign";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

type RouteParams = { params: Promise<{ id: string }> };

function attackSimulationDisabled() {
  return NextResponse.json({ error: "Attack Simulation is not enabled" }, { status: 404 });
}

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

  if (!isFeatureEnabled("attack_simulation", { organizationId: access.project.organization_id })) {
    return attackSimulationDisabled();
  }

  const admin = createAdminClient();
  const campaigns = await listAttackCampaignsForProject(admin, {
    projectId,
    organizationId: access.project.organization_id,
    limit: 20,
  });

  const latest = await getLatestAttackCenterCampaignForProject(admin, {
    projectId,
    organizationId: access.project.organization_id,
  });

  return NextResponse.json({
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      status: campaign.status,
      commitSha: campaign.commitSha,
      progressPercent: campaign.progressPercent,
      updatedAt: campaign.updatedAt,
    })),
    snapshot: latest,
  });
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
    return attackSimulationDisabled();
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
    return NextResponse.json({ ok: false, error: "Could not start attack campaign" }, { status: 500 });
  }
}
