import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackExecution } from "../contracts/attack-execution";
import type { ProtectionVerification } from "../contracts/protection-verification";
import { getAttackCampaignById } from "../persistence/campaign-repository";
import { getAttackScenarioById } from "../persistence/campaign-repository";
import { getAttackEvidenceForExecution } from "../persistence/evidence-repository";
import {
  finalizeAttackExecution,
  getAttackExecutionById,
} from "../persistence/execution-repository";
import { getAttackFindingForExecution } from "../persistence/finding-repository";
import { getAttackSafeFixForFinding } from "../persistence/attack-safe-fix-repository";
import { createProtectionVerification, getProtectionVerificationForReplay } from "../persistence/protection-verification-repository";
import {
  completeAttackReplay,
  createAttackReplay,
  getLatestAttackReplayForExecution,
} from "../persistence/replay-repository";
import { appendAttackRuntimeEvent } from "../persistence/runtime-event-repository";
import { executeAttackExecution } from "../executor/execution-service";
import { compareProtectionEvidence } from "./compare-evidence";
import { createReplayExecutionForOriginal } from "./create-replay-execution";

const REPLAYABLE_STATUSES = new Set<AttackExecution["status"]>([
  "fix_ready",
  "confirmed",
  "protected",
  "still_vulnerable",
  "replaying",
]);

export type RunAttackReplayInput = {
  organizationId: string;
  originalExecutionId: string;
  findingId?: string | null;
  safeFixId?: string | null;
  targetUrl?: string | null;
  skipIfVerified?: boolean;
};

export type RunAttackReplayResult =
  | {
      ok: true;
      skipped: true;
      reason: "already_verified";
      verification: ProtectionVerification;
    }
  | {
      ok: true;
      skipped: false;
      replayId: string;
      replayExecutionId: string;
      verification: ProtectionVerification;
      outcome: ProtectionVerification["outcome"];
    }
  | { ok: false; failureCode: string; safeFailureMessage: string };

export async function runAttackReplay(
  admin: SupabaseClient,
  input: RunAttackReplayInput
): Promise<RunAttackReplayResult> {
  const originalExecution = await getAttackExecutionById(
    admin,
    input.originalExecutionId,
    input.organizationId
  );
  if (!originalExecution) {
    return {
      ok: false,
      failureCode: "EXECUTION_NOT_FOUND",
      safeFailureMessage: "Original attack execution was not found",
    };
  }

  if (!REPLAYABLE_STATUSES.has(originalExecution.status)) {
    return {
      ok: false,
      failureCode: "EXECUTION_NOT_REPLAYABLE",
      safeFailureMessage: `Execution status ${originalExecution.status} cannot be replayed yet`,
    };
  }

  if (input.skipIfVerified) {
    const existingReplay = await getLatestAttackReplayForExecution(
      admin,
      originalExecution.id,
      input.organizationId
    );
    if (existingReplay) {
      const existingVerification = await getProtectionVerificationForReplay(
        admin,
        existingReplay.id,
        input.organizationId
      );
      if (existingVerification && existingVerification.outcome === "protected") {
        return {
          ok: true,
          skipped: true,
          reason: "already_verified",
          verification: existingVerification,
        };
      }
    }
  }

  const campaign = await getAttackCampaignById(
    admin,
    originalExecution.campaignId,
    input.organizationId
  );
  if (!campaign) {
    return {
      ok: false,
      failureCode: "CAMPAIGN_NOT_FOUND",
      safeFailureMessage: "Attack campaign was not found",
    };
  }

  const scenario = await getAttackScenarioById(
    admin,
    originalExecution.scenarioId,
    input.organizationId
  );
  if (!scenario) {
    return {
      ok: false,
      failureCode: "SCENARIO_NOT_FOUND",
      safeFailureMessage: "Attack scenario was not found",
    };
  }

  const originalEvidence = await getAttackEvidenceForExecution(
    admin,
    originalExecution.id,
    input.organizationId
  );
  if (!originalEvidence) {
    return {
      ok: false,
      failureCode: "ORIGINAL_EVIDENCE_MISSING",
      safeFailureMessage: "Original attack evidence is required before replay",
    };
  }

  const finding = await getAttackFindingForExecution(
    admin,
    originalExecution.id,
    input.organizationId
  );

  const safeFix = finding
    ? await getAttackSafeFixForFinding(admin, finding.id, input.organizationId)
    : null;

  await finalizeAttackExecution(admin, {
    executionId: originalExecution.id,
    organizationId: input.organizationId,
    status: "replaying",
    currentStage: "replaying",
  });

  const replayExecution = await createReplayExecutionForOriginal(admin, {
    campaign,
    originalExecution,
    scenario,
  });

  const replay = await createAttackReplay(admin, {
    campaignId: campaign.id,
    organizationId: campaign.organizationId,
    projectId: campaign.projectId,
    originalExecutionId: originalExecution.id,
    replayExecutionId: replayExecution.id,
    findingId: finding?.id ?? null,
    safeFixId: safeFix?.id ?? input.safeFixId ?? null,
  });

  await appendAttackRuntimeEvent(admin, {
    campaignId: campaign.id,
    executionId: originalExecution.id,
    stepId: null,
    organizationId: campaign.organizationId,
    projectId: campaign.projectId,
    correlationId: originalExecution.correlationId,
    eventType: "attack_replay_started",
    payload: {
      metadata: {
        replayId: replay.id,
        replayExecutionId: replayExecution.id,
        attackFindingId: finding?.id ?? null,
      },
    },
  });

  const replayRun = await executeAttackExecution(admin, {
    organizationId: input.organizationId,
    executionId: replayExecution.id,
    targetUrl: input.targetUrl ?? null,
  });

  if (!replayRun.ok) {
    return {
      ok: false,
      failureCode: replayRun.failureCode,
      safeFailureMessage: replayRun.safeFailureMessage,
    };
  }

  const replayEvidence = await getAttackEvidenceForExecution(
    admin,
    replayExecution.id,
    input.organizationId
  );
  if (!replayEvidence) {
    return {
      ok: false,
      failureCode: "REPLAY_EVIDENCE_MISSING",
      safeFailureMessage: "Replay run did not produce evidence",
    };
  }

  const comparison = compareProtectionEvidence({
    originalEvidence,
    replayEvidence,
    scenario,
    originalFindingConfirmed: finding?.outcome === "confirmed",
  });

  const verification = await createProtectionVerification(admin, {
    replayId: replay.id,
    campaignId: campaign.id,
    organizationId: campaign.organizationId,
    projectId: campaign.projectId,
    originalExecutionId: originalExecution.id,
    replayExecutionId: replayExecution.id,
    findingId: finding?.id ?? null,
    outcome: comparison.outcome,
    originalEvidenceId: originalEvidence.id,
    replayEvidenceId: replayEvidence.id,
    comparison: {
      summary: comparison.summary,
      ...comparison.comparison,
    },
  });

  await completeAttackReplay(admin, {
    replayId: replay.id,
    organizationId: input.organizationId,
  });

  const originalTerminalStatus =
    comparison.outcome === "protected"
      ? "protected"
      : comparison.outcome === "still_vulnerable"
        ? "still_vulnerable"
        : "evaluating";

  await finalizeAttackExecution(admin, {
    executionId: originalExecution.id,
    organizationId: input.organizationId,
    status: originalTerminalStatus,
    currentStage: originalTerminalStatus,
    completedAt: new Date().toISOString(),
  });

  await finalizeAttackExecution(admin, {
    executionId: replayExecution.id,
    organizationId: input.organizationId,
    status: "completed",
    currentStage: "completed",
    completedAt: new Date().toISOString(),
  });

  await appendAttackRuntimeEvent(admin, {
    campaignId: campaign.id,
    executionId: originalExecution.id,
    stepId: null,
    organizationId: campaign.organizationId,
    projectId: campaign.projectId,
    correlationId: originalExecution.correlationId,
    eventType:
      comparison.outcome === "protected"
        ? "protection_verified"
        : comparison.outcome === "still_vulnerable"
          ? "attack_still_vulnerable"
          : "attack_step_completed",
    payload: {
      metadata: {
        replayId: replay.id,
        verificationId: verification.id,
        outcome: comparison.outcome,
        summary: comparison.summary,
      },
    },
  });

  return {
    ok: true,
    skipped: false,
    replayId: replay.id,
    replayExecutionId: replayExecution.id,
    verification,
    outcome: comparison.outcome,
  };
}
