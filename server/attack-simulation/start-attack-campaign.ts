import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import type { AttackRuntimeMode } from "./contracts/enums";
import { attackHypothesisListSchema } from "./contracts/attack-hypothesis";
import {
  createAttackCampaign,
  getAttackCampaignByScanId,
} from "./persistence/campaign-repository";
import { listAttackExecutionsForCampaign } from "./persistence/execution-repository";
import { validateProductionDynamicGate } from "./dynamic/production-gate";
import {
  DYNAMIC_TESTING_UNAVAILABLE_CODE,
  DYNAMIC_TESTING_UNAVAILABLE_MESSAGE,
  isDynamicRuntimeModeName,
  isDynamicSecurityTestingAvailable,
} from "./availability";
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

async function loadCampaignAuthorization(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    authorizationId: string;
  }
): Promise<AttackAuthorizationRecord | null> {
  const { data } = await admin
    .from("attack_authorizations")
    .select("*")
    .eq("id", input.authorizationId)
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .maybeSingle();

  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    targetOrigin: row.target_origin as string,
    environmentType: row.environment_type as AttackAuthorizationRecord["environmentType"],
    status: row.status as AttackAuthorizationRecord["status"],
    authorizationMethod: row.authorization_method as string,
    approvedScope: (row.approved_scope as Record<string, unknown>) ?? {},
    createdBy: (row.created_by as string | null) ?? null,
    approvedAt: row.approved_at as string,
    expiresAt: row.expires_at as string,
    testCredentialsRef: (row.test_credentials_ref as string | null) ?? null,
    pathExclusions: (row.path_exclusions as string[]) ?? [],
    redirectAllowlist: (row.redirect_allowlist as string[]) ?? [],
    maxRequestBudget: row.max_request_budget as number,
    maxDurationSeconds: row.max_duration_seconds as number,
    commitSha: (row.commit_sha as string | null) ?? null,
  };
}

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

  // Dynamic runtimes send real HTTP: closed in V1 whatever the caller, authorization or flag says.
  if (isDynamicRuntimeModeName(parsed.data.runtimeMode) && !isDynamicSecurityTestingAvailable()) {
    throw new StartAttackCampaignError(
      DYNAMIC_TESTING_UNAVAILABLE_MESSAGE,
      DYNAMIC_TESTING_UNAVAILABLE_CODE,
      403
    );
  }

  // No default hypothesis: a campaign only exists for hypotheses the caller supplies (derived from real findings).
  const hypotheses = parsed.data.hypotheses;
  if (!hypotheses || hypotheses.length === 0) {
    throw new StartAttackCampaignError(
      "A campaign requires hypotheses derived from analysis findings; none was provided",
      "HYPOTHESES_REQUIRED"
    );
  }

  const campaign = await createAttackCampaign(admin, {
    scanId: parsed.data.scanId,
    scanJobId: parsed.data.scanJobId ?? null,
    projectId: input.projectId,
    organizationId: input.organizationId,
    commitSha: parsed.data.commitSha,
    runtimeMode: parsed.data.runtimeMode as AttackRuntimeMode,
    authorizationId: parsed.data.authorizationId ?? null,
  });

  const authorization =
    parsed.data.authorizationId != null
      ? await loadCampaignAuthorization(admin, {
          organizationId: input.organizationId,
          projectId: input.projectId,
          authorizationId: parsed.data.authorizationId,
        })
      : null;

  if (authorization) {
    const productionGate = validateProductionDynamicGate(authorization, {
      targetUrl: parsed.data.targetUrl ?? authorization.targetOrigin,
    });
    if (!productionGate.ok) {
      throw new StartAttackCampaignError(
        productionGate.message,
        productionGate.code.toUpperCase()
      );
    }
  }

  const planned = await planAndPersistCampaignFromHypotheses(admin, {
    campaign,
    hypotheses,
    authorization,
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
