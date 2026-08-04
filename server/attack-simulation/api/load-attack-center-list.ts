import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAttackCenterCampaignSnapshot,
  getLatestAttackCenterCampaignForProject,
} from "../get-attack-center";
import {
  getAttackCampaignByScanId,
  listAttackCampaignsForProject,
} from "../persistence/campaign-repository";
import {
  buildAttackCenterListResponse,
  type AttackCenterListResponse,
} from "./attack-center-contract";
import { attackCenterErrorFromSupabase } from "./errors";

export async function loadAttackCenterListState(
  admin: SupabaseClient,
  input: { projectId: string; organizationId: string; analysisRunId?: string | null }
): Promise<AttackCenterListResponse> {
  if (input.analysisRunId) {
    const runCampaign = await getAttackCampaignByScanId(
      admin,
      input.analysisRunId,
      input.organizationId
    );
    const campaigns = runCampaign ? [runCampaign] : [];
    const activeCampaign = runCampaign
      ? await getAttackCenterCampaignSnapshot(admin, {
          projectId: input.projectId,
          organizationId: input.organizationId,
          campaignId: runCampaign.id,
        })
      : null;

    return buildAttackCenterListResponse({
      organizationId: input.organizationId,
      campaigns,
      activeCampaign,
    });
  }

  const campaigns = await listAttackCampaignsForProject(admin, {
    projectId: input.projectId,
    organizationId: input.organizationId,
    limit: 20,
  });

  const activeCampaign = await getLatestAttackCenterCampaignForProject(admin, {
    projectId: input.projectId,
    organizationId: input.organizationId,
  });

  return buildAttackCenterListResponse({
    organizationId: input.organizationId,
    campaigns,
    activeCampaign,
  });
}

export async function probeAttackSimulationInfrastructure(
  admin: SupabaseClient
): Promise<void> {
  const { error } = await admin.from("attack_simulation_campaigns").select("id").limit(1);
  if (error) {
    throw attackCenterErrorFromSupabase(error);
  }
}
