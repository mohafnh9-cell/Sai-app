import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import type { RedTeamReport } from "@/server/ai-red-team/types";
import { isFeatureEnabled } from "@/server/feature-flags";
import { getActiveAttackAuthorization } from "@/server/ai-red-team/authorization/store";
import type { AttackHypothesis } from "../contracts/attack-hypothesis";
import { createAttackCampaign, getAttackCampaignByScanId } from "../persistence/campaign-repository";
import { listAttackExecutionsForCampaign } from "../persistence/execution-repository";
import type { StackProfile } from "@/features/security-scanner/types";
import {
  repositoryModelFromSummary,
  type RepositoryModel,
  type RepositoryModelSummary,
} from "@/brain/repository-model";
import { enqueueAttackExecutionRun } from "../executor/enqueue-attack-execution";
import { appendAttackRuntimeEvent } from "../persistence/runtime-event-repository";
import { extractAttackHypothesesFromRedTeamReport } from "./extract-hypotheses-from-report";
import { resolveAttackRuntimeModeForScan } from "./resolve-runtime-mode";
import type { ScanAttackSimulationPhaseResult } from "./types";

export async function bootstrapAttackCampaignFromScan(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    scanJobId: string | null;
    commitSha: string;
    report: RedTeamReport | null;
    hypotheses?: AttackHypothesis[];
    authorization?: AttackAuthorizationRecord | null;
    targetUrl?: string | null;
  }
): Promise<ScanAttackSimulationPhaseResult> {
  if (!isFeatureEnabled("attack_simulation", { organizationId: input.organizationId })) {
    return { ok: true, skipped: true, reason: "feature_disabled" };
  }

  const existing = await getAttackCampaignByScanId(admin, input.scanId, input.organizationId);
  if (existing) {
    return {
      ok: true,
      skipped: true,
      reason: "existing_campaign",
      campaignId: existing.id,
    };
  }

  const hypotheses =
    input.hypotheses ?? extractAttackHypothesesFromRedTeamReport(input.report ?? null);
  if (hypotheses.length === 0) {
    return { ok: true, skipped: true, reason: "no_hypotheses" };
  }

  let authorization = input.authorization ?? null;
  if (!authorization && input.targetUrl) {
    try {
      const origin = new URL(input.targetUrl).origin;
      authorization = await getActiveAttackAuthorization(admin, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        targetOrigin: origin,
      });
    } catch {
      authorization = null;
    }
  }

  const runtimeMode = resolveAttackRuntimeModeForScan({
    authorization,
    targetUrl: input.targetUrl ?? null,
  });

  const campaign = await createAttackCampaign(admin, {
    scanId: input.scanId,
    scanJobId: input.scanJobId,
    projectId: input.projectId,
    organizationId: input.organizationId,
    commitSha: input.commitSha,
    runtimeMode,
    authorizationId: authorization?.id ?? null,
  });

  await appendAttackRuntimeEvent(admin, {
    campaignId: campaign.id,
    executionId: null,
    stepId: null,
    organizationId: campaign.organizationId,
    projectId: campaign.projectId,
    correlationId: campaign.correlationId,
    eventType: "attack_campaign_started",
    payload: {
      metadata: {
        scanId: input.scanId,
        hypothesisCount: hypotheses.length,
        runtimeMode,
      },
    },
  });

  const planned = await planAndPersistCampaignFromHypotheses(admin, {
    campaign,
    hypotheses,
    authorization,
    targetUrl: input.targetUrl ?? null,
    repositoryModel: await loadRepositoryModelForScan(admin, input.scanId),
  });

  if (!planned.ok) {
    return {
      ok: false,
      failureCode: planned.failureCode,
      safeFailureMessage: planned.safeFailureMessage,
    };
  }

  for (const executionId of planned.executionIds) {
    await enqueueAttackExecutionRun(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      campaignId: planned.campaign.id,
      executionId,
      targetUrl: input.targetUrl ?? null,
    });
  }

  return {
    ok: true,
    skipped: false,
    campaignId: planned.campaign.id,
    executionIds: planned.executionIds,
    hypothesisCount: hypotheses.length,
  };
}

export async function getExistingScanCampaignExecutionIds(
  admin: SupabaseClient,
  input: { scanId: string; organizationId: string }
): Promise<{ campaignId: string; executionIds: string[] } | null> {
  const campaign = await getAttackCampaignByScanId(admin, input.scanId, input.organizationId);
  if (!campaign) return null;
  const executions = await listAttackExecutionsForCampaign(
    admin,
    campaign.id,
    input.organizationId
  );
  return {
    campaignId: campaign.id,
    executionIds: executions.map((execution) => execution.id),
  };
}

async function loadRepositoryModelForScan(
  admin: SupabaseClient,
  scanId: string
): Promise<RepositoryModel | null> {
  const { data } = await admin
    .from("scans")
    .select("metrics, detected_stack")
    .eq("id", scanId)
    .maybeSingle();
  if (!data) return null;

  const metrics = (data.metrics as Record<string, unknown> | null) ?? null;
  const summary = metrics?.repositoryModel as RepositoryModelSummary | undefined;
  const stack = (data.detected_stack as StackProfile | null) ?? { languages: [], frameworks: [], services: [], packageManagers: [], dependencies: {} };
  if (!summary) return null;
  return repositoryModelFromSummary(summary, stack);
}
