import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import {
  getAttackCampaignByScanId,
  getAttackCampaignById,
} from "@/server/attack-simulation/persistence/campaign-repository";
import { listAttackExecutionsForCampaign } from "@/server/attack-simulation/persistence/execution-repository";
import { TERMINAL_ATTACK_CAMPAIGN_STATUSES, TERMINAL_ATTACK_EXECUTION_STATUSES } from "@/server/attack-simulation/contracts/enums";

const DEFAULT_REVIEW_POLL_MS = 300_000;
const DEFAULT_ATTACK_POLL_MS = 180_000;
const DEFAULT_INTERVAL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalReviewStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "stale";
}

export async function pollUntilReviewTerminal(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string },
  options?: { maxMs?: number; intervalMs?: number }
): Promise<{ scanId: string | null; status: string; timedOut: boolean }> {
  const maxMs = options?.maxMs ?? DEFAULT_REVIEW_POLL_MS;
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxMs) {
    const state = await getProductionReviewState(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
    });

    if (!state.hasActiveReview && state.scanId && isTerminalReviewStatus(state.status)) {
      return { scanId: state.scanId, status: state.status, timedOut: false };
    }

    if (!state.hasActiveReview && state.status === "idle") {
      const { data: latestScan } = await admin
        .from("scans")
        .select("id, status")
        .eq("repository_id", input.projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestScan && isTerminalReviewStatus(String(latestScan.status))) {
        return {
          scanId: latestScan.id as string,
          status: String(latestScan.status),
          timedOut: false,
        };
      }
    }

    if (state.hasActiveReview && state.scanId && isTerminalReviewStatus(state.status)) {
      return { scanId: state.scanId, status: state.status, timedOut: false };
    }

    await sleep(intervalMs);
  }

  const finalState = await getProductionReviewState(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
  });

  return {
    scanId: finalState.scanId,
    status: finalState.status,
    timedOut: true,
  };
}

export async function pollUntilAttackCampaignTerminal(
  admin: SupabaseClient,
  input: { campaignId: string; organizationId: string },
  options?: { maxMs?: number; intervalMs?: number }
): Promise<{ timedOut: boolean; campaignStatus: string; executionsCompleted: number; executionsTotal: number }> {
  const maxMs = options?.maxMs ?? DEFAULT_ATTACK_POLL_MS;
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxMs) {
    const campaign = await getAttackCampaignById(admin, input.campaignId, input.organizationId);
    if (!campaign) {
      return {
        timedOut: false,
        campaignStatus: "missing",
        executionsCompleted: 0,
        executionsTotal: 0,
      };
    }

    const executions = await listAttackExecutionsForCampaign(
      admin,
      input.campaignId,
      input.organizationId
    );
    const allTerminal =
      executions.length > 0 &&
      executions.every((execution) => TERMINAL_ATTACK_EXECUTION_STATUSES.has(execution.status));
    const campaignTerminal = TERMINAL_ATTACK_CAMPAIGN_STATUSES.has(campaign.status);

    if (allTerminal || campaignTerminal) {
      return {
        timedOut: false,
        campaignStatus: campaign.status,
        executionsCompleted: executions.filter((execution) =>
          TERMINAL_ATTACK_EXECUTION_STATUSES.has(execution.status)
        ).length,
        executionsTotal: executions.length,
      };
    }

    await sleep(intervalMs);
  }

  const campaign = await getAttackCampaignById(admin, input.campaignId, input.organizationId);
  const executions = campaign
    ? await listAttackExecutionsForCampaign(admin, input.campaignId, input.organizationId)
    : [];

  return {
    timedOut: true,
    campaignStatus: campaign?.status ?? "unknown",
    executionsCompleted: executions.filter((execution) =>
      TERMINAL_ATTACK_EXECUTION_STATUSES.has(execution.status)
    ).length,
    executionsTotal: executions.length,
  };
}

export async function waitForScanCampaign(
  admin: SupabaseClient,
  input: { scanId: string; organizationId: string },
  options?: { maxMs?: number; intervalMs?: number }
): Promise<{ campaignId: string | null; timedOut: boolean }> {
  const maxMs = options?.maxMs ?? DEFAULT_ATTACK_POLL_MS;
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxMs) {
    const campaign = await getAttackCampaignByScanId(admin, input.scanId, input.organizationId);
    if (campaign) {
      const poll = await pollUntilAttackCampaignTerminal(
        admin,
        { campaignId: campaign.id, organizationId: input.organizationId },
        { maxMs: Math.max(5_000, maxMs - (Date.now() - startedAt)), intervalMs }
      );
      return { campaignId: campaign.id, timedOut: poll.timedOut };
    }
    await sleep(intervalMs);
  }

  const campaign = await getAttackCampaignByScanId(admin, input.scanId, input.organizationId);
  return { campaignId: campaign?.id ?? null, timedOut: true };
}
