import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import type { AttackExecution } from "../contracts/attack-execution";
import { TERMINAL_ATTACK_EXECUTION_STATUSES } from "../contracts/enums";
import {
  getAttackCampaignById,
  getAttackScenarioById,
  updateAttackCampaignProgress,
  updateAttackCampaignStatus,
} from "../persistence/campaign-repository";
import {
  finalizeAttackExecution,
  getAttackExecutionById,
  listAttackExecutionSteps,
  listAttackExecutionStepsForCampaign,
  markAttackExecutionRunning,
  updateAttackExecutionProgressFromSteps,
  updateAttackExecutionStepStatus,
} from "../persistence/execution-repository";
import { appendAttackRuntimeEvent } from "../persistence/runtime-event-repository";
import {
  cleanupSafeRuntimeSession,
  createSafeRuntimeSession,
} from "../runtime/safe-runtime";
import {
  appendEvidenceCapture,
  createEvidenceCaptureBuffer,
} from "../evidence/capture-buffer";
import { persistAttackEvidenceFromRun } from "../evidence/persist-evidence";
import { processAttackRemediation } from "../mitigation/process-remediation";
import { runAttackExecutionSteps } from "./run-execution-steps";
import { resolveExecutionStageForStepKind } from "./step-stage-map";
import type { AttackExecutionRunContext, AttackExecutionRunSignal } from "./types";

async function loadAttackAuthorizationById(
  admin: SupabaseClient,
  input: { authorizationId: string; organizationId: string; projectId: string }
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

export type ExecuteAttackExecutionInput = {
  organizationId: string;
  executionId: string;
  targetUrl?: string | null;
  authorization?: AttackAuthorizationRecord | null;
  signal?: AttackExecutionRunSignal;
};

export type ExecuteAttackExecutionResult =
  | {
      ok: true;
      skipped: true;
      reason: "already_terminal";
      execution: AttackExecution;
    }
  | {
      ok: true;
      skipped: false;
      execution: AttackExecution;
      stepCount: number;
      evidenceId: string | null;
      findingId: string | null;
      attackSafeFixId: string | null;
    }
  | {
      ok: false;
      failureCode: string;
      safeFailureMessage: string;
    };

export async function executeAttackExecution(
  admin: SupabaseClient,
  input: ExecuteAttackExecutionInput
): Promise<ExecuteAttackExecutionResult> {
  const execution = await getAttackExecutionById(admin, input.executionId, input.organizationId);
  if (!execution) {
    return {
      ok: false,
      failureCode: "EXECUTION_NOT_FOUND",
      safeFailureMessage: "Attack execution was not found",
    };
  }

  if (TERMINAL_ATTACK_EXECUTION_STATUSES.has(execution.status)) {
    return { ok: true, skipped: true, reason: "already_terminal", execution };
  }

  const campaign = await getAttackCampaignById(admin, execution.campaignId, input.organizationId);
  if (!campaign) {
    return {
      ok: false,
      failureCode: "CAMPAIGN_NOT_FOUND",
      safeFailureMessage: "Attack campaign was not found",
    };
  }

  if (campaign.status === "cancelled" || campaign.status === "failed") {
    return {
      ok: false,
      failureCode: "CAMPAIGN_NOT_RUNNABLE",
      safeFailureMessage: "Attack campaign is not runnable",
    };
  }

  const scenario = await getAttackScenarioById(admin, execution.scenarioId, input.organizationId);
  if (!scenario) {
    return {
      ok: false,
      failureCode: "SCENARIO_NOT_FOUND",
      safeFailureMessage: "Attack scenario was not found",
    };
  }

  const steps = await listAttackExecutionSteps(admin, execution.id, input.organizationId);
  if (steps.length === 0) {
    return {
      ok: false,
      failureCode: "NO_EXECUTION_STEPS",
      safeFailureMessage: "Attack execution has no steps to run",
    };
  }

  let authorization = input.authorization ?? null;
  if (!authorization && campaign.authorizationId) {
    authorization = await loadAttackAuthorizationById(admin, {
      authorizationId: campaign.authorizationId,
      organizationId: campaign.organizationId,
      projectId: campaign.projectId,
    });
  }

  const now = new Date().toISOString();
  await updateAttackCampaignStatus(admin, {
    campaignId: campaign.id,
    organizationId: campaign.organizationId,
    status: "running",
    startedAt: campaign.startedAt ?? now,
  });

  await appendAttackRuntimeEvent(admin, {
    campaignId: campaign.id,
    executionId: execution.id,
    stepId: null,
    organizationId: campaign.organizationId,
    projectId: campaign.projectId,
    correlationId: execution.correlationId,
    eventType: "attack_execution_started",
    payload: {
      metadata: { adapterId: scenario.adapterId, scenarioId: scenario.id },
    },
  });

  const session = createSafeRuntimeSession({
    mode: execution.runtimeMode,
    tenant: {
      organizationId: execution.organizationId,
      projectId: execution.projectId,
      campaignId: execution.campaignId,
      executionId: execution.id,
      correlationId: execution.correlationId,
    },
    commitSha: execution.commitSha,
    authorization,
    targetUrl: input.targetUrl ?? null,
  });

  const context: AttackExecutionRunContext = {
    campaign,
    execution,
    scenario,
    steps,
  };

  let evidenceBuffer = createEvidenceCaptureBuffer();

  const runResult = await runAttackExecutionSteps({
    context,
    session,
    signal: input.signal,
    fixtures:
      scenario.metadata && typeof scenario.metadata.fixtures === "object"
        ? (scenario.metadata.fixtures as Record<string, unknown>)
        : undefined,
    onBeforeStep: async (step) => {
      const stage = resolveExecutionStageForStepKind(step.kind);
      await markAttackExecutionRunning(admin, {
        executionId: execution.id,
        organizationId: execution.organizationId,
        currentStepId: step.id,
        currentStepTitle: step.label,
        currentStage: stage,
      });
      await updateAttackExecutionStepStatus(admin, {
        stepId: step.id,
        organizationId: execution.organizationId,
        status: "running",
        startedAt: new Date().toISOString(),
      });
      await appendAttackRuntimeEvent(admin, {
        campaignId: campaign.id,
        executionId: execution.id,
        stepId: step.id,
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        correlationId: execution.correlationId,
        eventType: "attack_step_started",
        payload: {
          stepKind: step.kind,
          stepLabel: step.label,
        },
      });
    },
    onAfterStep: async (step, result) => {
      evidenceBuffer = appendEvidenceCapture(evidenceBuffer, {
        stepId: step.id,
        stepKind: step.kind,
        stepLabel: step.label,
        runtimeResult: result.runtimeResult,
        capturedAtMs: result.completedAtMs,
      });

      const completedAt = new Date().toISOString();
      const updatedStep = await updateAttackExecutionStepStatus(admin, {
        stepId: step.id,
        organizationId: execution.organizationId,
        status: result.stepStatus,
        completedAt,
        durationMs: result.runtimeResult.durationMs,
        failureCode: result.runtimeResult.failureCode ?? null,
      });

      const allSteps = await listAttackExecutionSteps(admin, execution.id, execution.organizationId);
      const replaced = allSteps.map((row) => (row.id === updatedStep.id ? updatedStep : row));
      await updateAttackExecutionProgressFromSteps(admin, {
        executionId: execution.id,
        organizationId: execution.organizationId,
        steps: replaced,
        currentStage: resolveExecutionStageForStepKind(step.kind),
        currentStepId: step.id,
        currentStepTitle: step.label,
      });

      const campaignSteps = await listAttackExecutionStepsForCampaign(
        admin,
        campaign.id,
        campaign.organizationId
      );
      await updateAttackCampaignProgress(admin, {
        campaignId: campaign.id,
        organizationId: campaign.organizationId,
        steps: campaignSteps,
        status: "running",
      });

      await appendAttackRuntimeEvent(admin, {
        campaignId: campaign.id,
        executionId: execution.id,
        stepId: step.id,
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        correlationId: execution.correlationId,
        eventType:
          result.runtimeResult.outcome === "blocked"
            ? "attack_blocked"
            : "attack_step_completed",
        payload: {
          stepKind: step.kind,
          metadata: {
            outcome: result.runtimeResult.outcome,
            classification: result.runtimeResult.classification,
          },
        },
      });
    },
  });

  let evidenceId: string | null = null;
  let findingId: string | null = null;
  let attackSafeFixId: string | null = null;

  if (evidenceBuffer.steps.length > 0) {
    const evidenceResult = await persistAttackEvidenceFromRun(admin, {
      campaign,
      execution,
      scenario,
      buffer: evidenceBuffer,
      targetUrl: input.targetUrl ?? null,
      preconditions: {
        runtimeMode: execution.runtimeMode,
        adapterId: scenario.adapterId,
        authorizationPresent: Boolean(authorization),
      },
      terminalBlocked: !runResult.ok && runResult.terminalStatus === "blocked",
      correlationId: execution.correlationId,
      skipIfExists: true,
    });
    if (evidenceResult.ok) {
      evidenceId = evidenceResult.evidence.id;

      const remediation = await processAttackRemediation(admin, {
        campaign,
        execution,
        scenario,
        evidence: evidenceResult.evidence,
        buffer: evidenceBuffer,
        executionBlocked: !runResult.ok || runResult.terminalStatus === "blocked",
        correlationId: execution.correlationId,
        skipIfExists: true,
      });
      if (remediation.ok) {
        findingId = remediation.findingId;
        attackSafeFixId = remediation.attackSafeFixId;
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const terminalStage = runResult.terminalStatus;
  const remediationFinalized = Boolean(findingId);

  if (runResult.ok && !remediationFinalized) {
    await finalizeAttackExecution(admin, {
      executionId: execution.id,
      organizationId: execution.organizationId,
      status: runResult.terminalStatus,
      currentStage: runResult.terminalStatus,
      completedAt: finishedAt,
    });
    await appendAttackRuntimeEvent(admin, {
      campaignId: campaign.id,
      executionId: execution.id,
      stepId: null,
      organizationId: campaign.organizationId,
      projectId: campaign.projectId,
      correlationId: execution.correlationId,
      eventType: "attack_cleanup_completed",
      payload: { metadata: { stepCount: runResult.stepResults.length } },
    });
  } else if (!remediationFinalized) {
    await finalizeAttackExecution(admin, {
      executionId: execution.id,
      organizationId: execution.organizationId,
      status: runResult.terminalStatus,
      currentStage: terminalStage,
      failureCode: runResult.failureCode,
      safeFailureMessage: runResult.safeFailureMessage,
      completedAt: runResult.terminalStatus === "cancelled" ? null : finishedAt,
      cancelledAt: runResult.terminalStatus === "cancelled" ? finishedAt : null,
    });
    await appendAttackRuntimeEvent(admin, {
      campaignId: campaign.id,
      executionId: execution.id,
      stepId: null,
      organizationId: campaign.organizationId,
      projectId: campaign.projectId,
      correlationId: execution.correlationId,
      eventType: runResult.terminalStatus === "blocked" ? "attack_blocked" : "attack_failed",
      payload: {
        safeMessage: runResult.safeFailureMessage,
        metadata: { failureCode: runResult.failureCode },
      },
    });
  }

  await cleanupSafeRuntimeSession(
    runResult.session,
    runResult.ok && runResult.terminalStatus === "completed"
      ? "completed"
      : runResult.terminalStatus === "cancelled"
        ? "cancelled"
        : "failed"
  );

  const finalExecution = await getAttackExecutionById(admin, execution.id, execution.organizationId);
  if (!finalExecution) {
    return {
      ok: false,
      failureCode: "EXECUTION_FINALIZE_FAILED",
      safeFailureMessage: "Attack execution could not be reloaded after run",
    };
  }

  if (!runResult.ok) {
    return {
      ok: false,
      failureCode: runResult.failureCode,
      safeFailureMessage: runResult.safeFailureMessage,
    };
  }

  return {
    ok: true,
    skipped: false,
    execution: finalExecution,
    stepCount: runResult.stepResults.length,
    evidenceId,
    findingId,
    attackSafeFixId,
  };
}
