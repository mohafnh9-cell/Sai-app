import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { getAttackFindingById } from "@/server/attack-simulation/persistence/finding-repository";
import { runAttackReplay } from "@/server/attack-simulation/replay/run-attack-replay";
import { getAttackCenterFindingSnapshot } from "@/server/attack-simulation/get-attack-center";

const paramsSchema = z.object({
  id: z.string().uuid(),
  findingId: z.string().uuid(),
});

const bodySchema = z.object({
  targetUrl: z.string().url().nullable().optional(),
  skipIfVerified: z.boolean().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; findingId: string }> }
) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
  }

  const { id: projectId, findingId } = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  if (!isFeatureEnabled("attack_simulation", { organizationId: access.project.organization_id })) {
    return NextResponse.json({ error: "Attack Simulation is not enabled" }, { status: 404 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const finding = await getAttackFindingById(admin, findingId, access.project.organization_id);
  if (!finding || finding.projectId !== projectId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const replayResult = await runAttackReplay(admin, {
    organizationId: access.project.organization_id,
    originalExecutionId: finding.executionId,
    findingId: finding.id,
    targetUrl: body.data.targetUrl ?? null,
    skipIfVerified: body.data.skipIfVerified ?? true,
  });

  if (!replayResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: replayResult.safeFailureMessage,
        code: replayResult.failureCode,
      },
      { status: 422 }
    );
  }

  const snapshot = await getAttackCenterFindingSnapshot(admin, {
    projectId,
    organizationId: access.project.organization_id,
    findingId,
  });

  return NextResponse.json({
    ok: true,
    skipped: replayResult.skipped,
    outcome: replayResult.skipped ? replayResult.verification.outcome : replayResult.outcome,
    replayId: replayResult.skipped ? null : replayResult.replayId,
    snapshot,
  });
}
