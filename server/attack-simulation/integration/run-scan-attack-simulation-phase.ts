import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedTeamReport } from "@/server/ai-red-team/types";
import { bootstrapAttackCampaignFromScan } from "./bootstrap-campaign-from-scan";
import type { ScanAttackSimulationPhaseResult } from "./types";

export async function runScanAttackSimulationPhase(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    scanJobId: string | null;
    commitSha: string;
    report: RedTeamReport | null;
    targetUrl?: string | null;
  }
): Promise<ScanAttackSimulationPhaseResult> {
  console.info({
    component: "attack-simulation",
    event: "scan_phase_started",
    scanId: input.scanId,
    projectId: input.projectId,
  });

  const result = await bootstrapAttackCampaignFromScan(admin, input);

  console.info({
    component: "attack-simulation",
    event: "scan_phase_finished",
    scanId: input.scanId,
    ok: result.ok,
    skipped: result.ok && "skipped" in result ? result.skipped : false,
    campaignId: result.ok && "campaignId" in result ? result.campaignId : null,
  });

  return result;
}
