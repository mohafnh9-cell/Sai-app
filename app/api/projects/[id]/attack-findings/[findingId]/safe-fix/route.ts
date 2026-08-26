import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { getAttackFindingById } from "@/server/attack-simulation/persistence/finding-repository";
import { getAttackMitigationForFinding } from "@/server/attack-simulation/persistence/mitigation-repository";
import { getAttackSafeFixForFinding } from "@/server/attack-simulation/persistence/attack-safe-fix-repository";
import { getAttackCampaignById } from "@/server/attack-simulation/persistence/campaign-repository";
import { bridgeAttackSafeFixToEngine } from "@/server/attack-simulation/integration/bridge-attack-safe-fix";

const paramsSchema = z.object({
  id: z.string().uuid(),
  findingId: z.string().uuid(),
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

  const admin = createAdminClient();
  const finding = await getAttackFindingById(admin, findingId, access.project.organization_id);
  if (!finding || finding.projectId !== projectId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [mitigation, attackSafeFix, campaign] = await Promise.all([
    getAttackMitigationForFinding(admin, finding.id, access.project.organization_id),
    getAttackSafeFixForFinding(admin, finding.id, access.project.organization_id),
    getAttackCampaignById(admin, finding.campaignId, access.project.organization_id),
  ]);

  if (!mitigation || !attackSafeFix || !campaign) {
    return NextResponse.json(
      { error: "Attack safe fix is not ready for this finding" },
      { status: 422 }
    );
  }

  const result = await bridgeAttackSafeFixToEngine(admin, {
    organizationId: access.project.organization_id,
    projectId,
    scanId: campaign.scanId,
    finding,
    mitigation,
    attackSafeFix,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.safeFailureMessage, code: result.failureCode },
      { status: 500 }
    );
  }

  return NextResponse.json(result);
}
