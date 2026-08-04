import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { getSecurityTestContext } from "@/server/attack-simulation/get-security-test-context";
import { mapSelectedTestsToHypotheses } from "@/server/attack-simulation/security-test-options";
import { getTranslator } from "@/lib/i18n/server";
import { startAttackCampaign, StartAttackCampaignError } from "@/server/attack-simulation/start-attack-campaign";
import { getAttackCenterCampaignSnapshot } from "@/server/attack-simulation/get-attack-center";
import { attackCenterErrorResponse } from "@/server/attack-simulation/api/errors";
import { buildAttackCenterDisabledResponse } from "@/server/attack-simulation/api/attack-center-contract";

const paramsSchema = z.object({ id: z.string().uuid() });

const postBodySchema = z.object({
  testIds: z.array(z.string().min(1)).min(1).max(20),
  analysisRunId: z.string().uuid().optional(),
});

function resolveAnalysisRunId(request: Request, bodyRunId?: string | null): string | null {
  const url = new URL(request.url);
  return bodyRunId ?? url.searchParams.get("run");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsed = paramsSchema.safeParse(await params);
  const { t } = await getTranslator("securityTest");
  if (!parsed.success) {
    return NextResponse.json({ error: t("errors.invalidProjectId") }, { status: 400 });
  }

  const projectId = parsed.data.id;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  if (!isFeatureEnabled("attack_simulation", { organizationId: access.project.organization_id })) {
    return NextResponse.json(buildAttackCenterDisabledResponse({ organizationId: access.project.organization_id }));
  }

  try {
    const admin = createAdminClient();
    const analysisRunId = resolveAnalysisRunId(request);
    const context = await getSecurityTestContext(admin, {
      projectId,
      organizationId: access.project.organization_id,
      analysisRunId,
    });
    const { hypotheses: _hypotheses, ...publicContext } = context;
    return NextResponse.json({ ok: true, ...publicContext });
  } catch (error) {
    return attackCenterErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsed = paramsSchema.safeParse(await params);
  const { t } = await getTranslator("securityTest");
  if (!parsed.success) {
    return NextResponse.json({ error: t("errors.invalidProjectId") }, { status: 400 });
  }

  const projectId = parsed.data.id;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  if (!isFeatureEnabled("attack_simulation", { organizationId: access.project.organization_id })) {
    return NextResponse.json(
      { ok: false, error: t("errors.notEnabled") },
      { status: 403 }
    );
  }

  try {
    const admin = createAdminClient();
    const body = postBodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ ok: false, error: t("errors.selectAtLeastOne") }, { status: 400 });
    }

    const analysisRunId = resolveAnalysisRunId(request, body.data.analysisRunId);
    const context = await getSecurityTestContext(admin, {
      projectId,
      organizationId: access.project.organization_id,
      analysisRunId,
    });

    if (!context.latestScan) {
      return NextResponse.json(
        {
          ok: false,
          error: t("errors.needsReviewFirst"),
          code: "needs_review",
        },
        { status: 409 }
      );
    }

    const hypotheses = mapSelectedTestsToHypotheses(body.data.testIds, context.hypotheses, t);
    if (hypotheses.length === 0) {
      return NextResponse.json(
        { ok: false, error: t("errors.mapFailed") },
        { status: 422 }
      );
    }

    const result = await startAttackCampaign(admin, {
      projectId,
      organizationId: access.project.organization_id,
      body: {
        scanId: context.latestScan.id,
        scanJobId: context.latestScan.scanJobId,
        commitSha: context.latestScan.commitSha,
        runtimeMode: "mock",
        hypotheses,
      },
    });

    const snapshot = await getAttackCenterCampaignSnapshot(admin, {
      projectId,
      organizationId: access.project.organization_id,
      campaignId: result.campaignId,
    });

    return NextResponse.json({
      ok: true,
      campaignId: result.campaignId,
      executionIds: result.executionIds,
      attackCenterHref: context.attackCenterHref,
      snapshot,
    });
  } catch (error) {
    if (error instanceof StartAttackCampaignError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    return attackCenterErrorResponse(error);
  }
}
