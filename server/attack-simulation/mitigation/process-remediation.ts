import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackEvidence } from "../contracts/attack-evidence";
import type { AttackExecutionStatus, AttackFindingOutcome } from "../contracts/enums";
import type { AttackCampaign } from "../contracts/attack-campaign";
import type { AttackExecution } from "../contracts/attack-execution";
import type { AttackScenario } from "../contracts/attack-scenario";
import type { EvidenceCaptureBuffer } from "../evidence/capture-buffer";
import { appendAttackRuntimeEvent } from "../persistence/runtime-event-repository";
import { finalizeAttackExecution } from "../persistence/execution-repository";
import {
  createAttackFinding,
  getAttackFindingForExecution,
} from "../persistence/finding-repository";
import {
  createAttackMitigation,
  getAttackMitigationForFinding,
} from "../persistence/mitigation-repository";
import {
  createAttackSafeFix,
  getAttackSafeFixForFinding,
} from "../persistence/attack-safe-fix-repository";
import { buildAttackFindingInput } from "./build-finding";
import { buildAttackMitigationInput } from "./build-mitigation";
import { buildAttackSafeFixInput } from "./build-safe-fix";
import { evaluateAttackOutcome } from "./evaluate-outcome";
import { bridgeAttackSafeFixToEngine } from "../integration/bridge-attack-safe-fix";

export type ProcessAttackRemediationInput = {
  campaign: Pick<AttackCampaign, "id" | "organizationId" | "projectId" | "scanId">;
  execution: Pick<AttackExecution, "id" | "correlationId">;
  scenario: Pick<
    AttackScenario,
    "id" | "title" | "description" | "category" | "hypothesisId" | "adapterId"
  >;
  evidence: AttackEvidence;
  buffer?: EvidenceCaptureBuffer;
  executionBlocked?: boolean;
  correlationId: string;
  skipIfExists?: boolean;
};

export type ProcessAttackRemediationResult =
  | {
      ok: true;
      findingId: string;
      outcome: AttackFindingOutcome;
      mitigationId: string | null;
      attackSafeFixId: string | null;
      executionStatus: AttackExecutionStatus;
    }
  | { ok: false; failureCode: string; safeFailureMessage: string };

function executionStatusForOutcome(outcome: AttackFindingOutcome): AttackExecutionStatus {
  if (outcome === "confirmed") return "confirmed";
  if (outcome === "not_exploitable") return "not_exploitable";
  if (outcome === "pending") return "completed";
  return "completed";
}

export async function processAttackRemediation(
  admin: SupabaseClient,
  input: ProcessAttackRemediationInput
): Promise<ProcessAttackRemediationResult> {
  if (input.skipIfExists) {
    const existing = await getAttackFindingForExecution(
      admin,
      input.execution.id,
      input.campaign.organizationId
    );
    if (existing) {
      const mitigation = await getAttackMitigationForFinding(
        admin,
        existing.id,
        input.campaign.organizationId
      );
      const safeFix = await getAttackSafeFixForFinding(
        admin,
        existing.id,
        input.campaign.organizationId
      );
      return {
        ok: true,
        findingId: existing.id,
        outcome: existing.outcome,
        mitigationId: mitigation?.id ?? null,
        attackSafeFixId: safeFix?.id ?? null,
        executionStatus: executionStatusForOutcome(existing.outcome),
      };
    }
  }

  const evaluation = evaluateAttackOutcome({
    evidence: input.evidence,
    scenario: input.scenario,
    buffer: input.buffer,
    executionBlocked: input.executionBlocked,
  });

  const finding = await createAttackFinding(
    admin,
    buildAttackFindingInput({
      campaign: input.campaign,
      execution: input.execution,
      scenario: input.scenario,
      evidence: input.evidence,
      evaluation,
    })
  );

  const executionStatus = executionStatusForOutcome(evaluation.outcome);

  if (evaluation.outcome === "confirmed") {
    await appendAttackRuntimeEvent(admin, {
      campaignId: input.campaign.id,
      executionId: input.execution.id,
      stepId: null,
      organizationId: input.campaign.organizationId,
      projectId: input.campaign.projectId,
      correlationId: input.correlationId,
      eventType: "attack_confirmed",
      payload: {
        metadata: { findingId: finding.id, severity: finding.severity },
      },
    });
  } else if (evaluation.outcome === "not_exploitable") {
    await appendAttackRuntimeEvent(admin, {
      campaignId: input.campaign.id,
      executionId: input.execution.id,
      stepId: null,
      organizationId: input.campaign.organizationId,
      projectId: input.campaign.projectId,
      correlationId: input.correlationId,
      eventType: "attack_not_exploitable",
      payload: {
        metadata: { findingId: finding.id },
      },
    });
  }

  let mitigationId: string | null = null;
  let attackSafeFixId: string | null = null;

  if (evaluation.outcome === "confirmed") {
    await appendAttackRuntimeEvent(admin, {
      campaignId: input.campaign.id,
      executionId: input.execution.id,
      stepId: null,
      organizationId: input.campaign.organizationId,
      projectId: input.campaign.projectId,
      correlationId: input.correlationId,
      eventType: "mitigation_generation_started",
      payload: { metadata: { findingId: finding.id } },
    });

    const mitigation = await createAttackMitigation(
      admin,
      buildAttackMitigationInput({
        finding,
        scenario: input.scenario,
        evidence: input.evidence,
      })
    );
    mitigationId = mitigation.id;

    const safeFix = await createAttackSafeFix(
      admin,
      buildAttackSafeFixInput({
        finding,
        mitigation,
        scenario: input.scenario,
      })
    );
    attackSafeFixId = safeFix.id;

    await bridgeAttackSafeFixToEngine(admin, {
      organizationId: input.campaign.organizationId,
      projectId: input.campaign.projectId,
      scanId: input.campaign.scanId,
      finding,
      mitigation,
      attackSafeFix: safeFix,
    }).catch(() => undefined);

    await appendAttackRuntimeEvent(admin, {
      campaignId: input.campaign.id,
      executionId: input.execution.id,
      stepId: null,
      organizationId: input.campaign.organizationId,
      projectId: input.campaign.projectId,
      correlationId: input.correlationId,
      eventType: "safe_fix_ready",
      payload: {
        metadata: {
          findingId: finding.id,
          attackFindingId: finding.id,
          attackSafeFixId: safeFix.id,
        },
      },
    });

    await finalizeAttackExecution(admin, {
      executionId: input.execution.id,
      organizationId: input.campaign.organizationId,
      status: "fix_ready",
      currentStage: "fix_ready",
      completedAt: new Date().toISOString(),
    });

    return {
      ok: true,
      findingId: finding.id,
      outcome: evaluation.outcome,
      mitigationId,
      attackSafeFixId,
      executionStatus: "fix_ready",
    };
  }

  await finalizeAttackExecution(admin, {
    executionId: input.execution.id,
    organizationId: input.campaign.organizationId,
    status: executionStatus,
    currentStage: executionStatus,
    completedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    findingId: finding.id,
    outcome: evaluation.outcome,
    mitigationId,
    attackSafeFixId,
    executionStatus,
  };
}
