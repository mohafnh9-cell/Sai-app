import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { getAttackCenterExecutionSnapshot } from "@/server/attack-simulation/get-attack-center";
import {
  buildAttackCenterCapability,
  buildAttackCenterDisabledResponse,
} from "@/server/attack-simulation/api/attack-center-contract";
import { attackCenterErrorResponse } from "@/server/attack-simulation/api/errors";

const paramsSchema = z.object({
  id: z.string().uuid(),
  executionId: z.string().uuid(),
});

export async function GET(
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
    return NextResponse.json(
      buildAttackCenterDisabledResponse({ organizationId: access.project.organization_id }),
      { status: 200 }
    );
  }

  try {
    const admin = createAdminClient();
    const snapshot = await getAttackCenterExecutionSnapshot(admin, {
      projectId,
      organizationId: access.project.organization_id,
      executionId,
    });

    if (!snapshot) {
      return NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      snapshot,
      capability: buildAttackCenterCapability({
        organizationId: access.project.organization_id,
      }),
    });
  } catch (error) {
    return attackCenterErrorResponse(error);
  }
}
