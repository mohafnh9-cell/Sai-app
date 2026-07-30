import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAttackCampaignById,
  listAttackScenariosForCampaign,
} from "./persistence/campaign-repository";
import {
  getAttackExecutionById,
  listAttackExecutionsForCampaign,
  listAttackExecutionSteps,
} from "./persistence/execution-repository";
import { getAttackEvidenceForExecution } from "./persistence/evidence-repository";
import { getAttackFindingById } from "./persistence/finding-repository";
import { getAttackMitigationForFinding } from "./persistence/mitigation-repository";
import { getAttackSafeFixForFinding } from "./persistence/attack-safe-fix-repository";
import { getProtectionVerificationForReplay, getProtectionVerificationForFinding } from "./persistence/protection-verification-repository";
import { getLatestAttackReplayForExecution } from "./persistence/replay-repository";
import { listAttackRuntimeEventsForCampaign } from "./persistence/runtime-event-repository";
import {
  buildAttackCenterCampaignView,
  buildAttackCenterExecutionView,
  buildAttackCenterFindingView,
} from "./ui/build-views";
import type { AttackCenterSnapshot } from "./ui/types";

export async function getAttackCenterCampaignSnapshot(
  client: SupabaseClient,
  input: { projectId: string; organizationId: string; campaignId: string }
): Promise<AttackCenterSnapshot | null> {
  const campaign = await getAttackCampaignById(client, input.campaignId, input.organizationId);
  if (!campaign || campaign.projectId !== input.projectId) return null;

  const [executions, scenarios, events] = await Promise.all([
    listAttackExecutionsForCampaign(client, campaign.id, input.organizationId),
    listAttackScenariosForCampaign(client, campaign.id, input.organizationId),
    listAttackRuntimeEventsForCampaign(client, {
      campaignId: campaign.id,
      organizationId: input.organizationId,
      limit: 50,
    }),
  ]);

  return buildAttackCenterCampaignView({
    projectId: input.projectId,
    campaign,
    executions,
    scenarios,
    events,
  });
}

export async function getAttackCenterExecutionSnapshot(
  client: SupabaseClient,
  input: { projectId: string; organizationId: string; executionId: string }
): Promise<AttackCenterSnapshot | null> {
  const execution = await getAttackExecutionById(client, input.executionId, input.organizationId);
  if (!execution || execution.projectId !== input.projectId) return null;

  const [steps, events] = await Promise.all([
    listAttackExecutionSteps(client, execution.id, input.organizationId),
    listAttackRuntimeEventsForCampaign(client, {
      campaignId: execution.campaignId,
      organizationId: input.organizationId,
      limit: 50,
    }),
  ]);

  const executionEvents = events.filter(
    (event) => event.executionId === execution.id || event.executionId === null
  );

  return buildAttackCenterExecutionView({
    projectId: input.projectId,
    execution,
    steps,
    events: executionEvents,
  });
}

export async function getAttackCenterFindingSnapshot(
  client: SupabaseClient,
  input: { projectId: string; organizationId: string; findingId: string }
): Promise<AttackCenterSnapshot | null> {
  const finding = await getAttackFindingById(client, input.findingId, input.organizationId);
  if (!finding || finding.projectId !== input.projectId) return null;

  const [mitigation, safeFix, evidence] = await Promise.all([
    getAttackMitigationForFinding(client, finding.id, input.organizationId),
    getAttackSafeFixForFinding(client, finding.id, input.organizationId),
    finding.evidenceId
      ? getAttackEvidenceForExecution(client, finding.executionId, input.organizationId)
      : Promise.resolve(null),
  ]);

  const replay = await getLatestAttackReplayForExecution(
    client,
    finding.executionId,
    input.organizationId
  );
  const verification = replay
    ? await getProtectionVerificationForReplay(client, replay.id, input.organizationId)
    : await getProtectionVerificationForFinding(client, finding.id, input.organizationId);

  return buildAttackCenterFindingView({
    projectId: input.projectId,
    finding,
    mitigation,
    safeFix,
    evidence,
    verification,
  });
}

export async function getLatestAttackCenterCampaignForProject(
  client: SupabaseClient,
  input: { projectId: string; organizationId: string }
): Promise<AttackCenterSnapshot | null> {
  const { data, error } = await client
    .from("attack_simulation_campaigns")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return getAttackCenterCampaignSnapshot(client, {
    projectId: input.projectId,
    organizationId: input.organizationId,
    campaignId: data.id as string,
  });
}
