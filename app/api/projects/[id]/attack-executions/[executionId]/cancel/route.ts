import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import {
  CancelAttackSimulationError,
  cancelAttackExecution,
} from "@/server/attack-simulation/cancel/cancel-attack";
import { getAttackCenterExecutionSnapshot } from "@/server/attack-simulation/get-attack-center";

const paramsSchema = z.object({
  id: z.string().uuid(),
  executionId: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
  }

  const { id: projectId, executionId } = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  if (!isFeatureEnabled("attack_simulation", { organizationId: access.project.organization_id })) {
    return NextResponse.json({ error: "Attack Simulation is not enabled" }, { status: 404 });
  }

  const admin = createAdminClient();

  try {
    const result = await cancelAttackExecution(admin, {
      executionId,
      organizationId: access.project.organization_id,
      projectId,
    });

    const snapshot = await getAttackCenterExecutionSnapshot(admin, {
      projectId,
      organizationId: access.project.organization_id,
      executionId,
    });

    return NextResponse.json({ ok: true, ...result, snapshot });
  } catch (error) {
    if (error instanceof CancelAttackSimulationError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    return NextResponse.json({ ok: false, error: "Could not cancel execution" }, { status: 500 });
  }
}
