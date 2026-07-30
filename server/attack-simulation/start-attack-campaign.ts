import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AttackRuntimeMode } from "./contracts/enums";
import {
  attackHypothesisListSchema,
  attackHypothesisFromRedTeamFinding,
} from "./contracts/attack-hypothesis";
import {
  createAttackCampaign,
  getAttackCampaignByScanId,
} from "./persistence/campaign-repository";
import { listAttackExecutionsForCampaign } from "./persistence/execution-repository";
import { planAndPersistCampaignFromHypotheses } from "./planner/plan-and-persist-campaign";
import { enqueueAttackExecutionRun } from "./executor/enqueue-attack-execution";

export class StartAttackCampaignError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "StartAttackCampaignError";
  }
}

const startAttackCampaignInputSchema = z.object({
  scanId: z.string().uuid(),
  scanJobId: z.string().uuid().nullable().optional(),
  commitSha: z.string().min(7).max(64),
  runtimeMode: z.enum(["static", "mock", "sandbox", "authorized_staging"]).default("mock"),
  authorizationId: z.string().uuid().nullable().optional(),
  targetUrl: z.string().url().nullable().optional(),
  hypotheses: attackHypothesisListSchema.optional(),
});

export type StartAttackCampaignInput = z.infer<typeof startAttackCampaignInputSchema>;

export async function startAttackCampaign(
  admin: SupabaseClient,
  input: {
    projectId: string;
    organizationId: string;
    body: unknown;
  }
): Promise<{
  campaignId: string;
  executionIds: string[];
  skippedHypotheses: Array<{ hypothesisId: string; reason: string }>;
}> {
  const parsed = startAttackCampaignInputSchema.safeParse(input.body);
  if (!parsed.success) {
    throw new StartAttackCampaignError(parsed.error.message, "VALIDATION_FAILED");
  }

  const existing = await getAttackCampaignByScanId(admin, parsed.data.scanId, input.organizationId);
  if (existing) {
    const executions = await listAttackExecutionsForCampaign(
      admin,
      existing.id,
      input.organizationId
    );
    return {
      campaignId: existing.id,
      executionIds: executions.map((execution) => execution.id),
      skippedHypotheses: [],
    };
  }

  const hypotheses =
    parsed.data.hypotheses ??
    [
      attackHypothesisFromRedTeamFinding({
        id: "demo-workflow-bypass",
        title: "Workflow bypass in checkout",
        description: "State transition may be skipped without payment confirmation.",
        category: "business_logic",
        severity: "high",
        confidence: 0.75,
        source: "attack_center.demo",
        metadata: { adapterHint: "workflow-bypass" },
      }),
    ];

  const campaign = await createAttackCampaign(admin, {
    scanId: parsed.data.scanId,
    scanJobId: parsed.data.scanJobId ?? null,
    projectId: input.projectId,
    organizationId: input.organizationId,
    commitSha: parsed.data.commitSha,
    runtimeMode: parsed.data.runtimeMode as AttackRuntimeMode,
    authorizationId: parsed.data.authorizationId ?? null,
  });

  const planned = await planAndPersistCampaignFromHypotheses(admin, {
    campaign,
    hypotheses,
    targetUrl: parsed.data.targetUrl ?? null,
  });

  if (!planned.ok) {
    throw new StartAttackCampaignError(
      planned.safeFailureMessage,
      planned.failureCode,
      planned.failureCode === "NO_PLANNABLE_SCENARIOS" ? 422 : 400
    );
  }

  for (const executionId of planned.executionIds) {
    await enqueueAttackExecutionRun(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      campaignId: planned.campaign.id,
      executionId,
      targetUrl: parsed.data.targetUrl ?? null,
    });
  }

  return {
    campaignId: planned.campaign.id,
    executionIds: planned.executionIds,
    skippedHypotheses: planned.skippedHypotheses,
  };
}
