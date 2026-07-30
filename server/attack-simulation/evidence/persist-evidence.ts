import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackEvidence } from "../contracts/attack-evidence";
import { appendAttackRuntimeEvent } from "../persistence/runtime-event-repository";
import { createAttackEvidence, getAttackEvidenceForExecution } from "../persistence/evidence-repository";
import { buildAttackEvidenceInput, type BuildAttackEvidenceInput } from "./build-evidence";

export type PersistAttackEvidenceResult =
  | { ok: true; evidence: AttackEvidence; created: true }
  | { ok: true; evidence: AttackEvidence; created: false }
  | { ok: false; failureCode: string; safeFailureMessage: string };

export async function persistAttackEvidenceFromRun(
  admin: SupabaseClient,
  input: BuildAttackEvidenceInput & {
    correlationId: string;
    skipIfExists?: boolean;
  }
): Promise<PersistAttackEvidenceResult> {
  if (input.buffer.steps.length === 0) {
    return {
      ok: false,
      failureCode: "NO_EVIDENCE_CAPTURED",
      safeFailureMessage: "No attack steps were captured for evidence",
    };
  }

  if (input.skipIfExists) {
    const existing = await getAttackEvidenceForExecution(
      admin,
      input.execution.id,
      input.campaign.organizationId
    );
    if (existing) {
      return { ok: true, evidence: existing, created: false };
    }
  }

  const evidenceInput = buildAttackEvidenceInput(input);
  const evidence = await createAttackEvidence(admin, evidenceInput);

  await appendAttackRuntimeEvent(admin, {
    campaignId: input.campaign.id,
    executionId: input.execution.id,
    stepId: null,
    organizationId: input.campaign.organizationId,
    projectId: input.campaign.projectId,
    correlationId: input.correlationId,
    eventType: "attack_evidence_collected",
    payload: {
      metadata: {
        evidenceId: evidence.id,
        confidence: evidence.confidence,
        partial: input.terminalBlocked ?? false,
      },
    },
  });

  return { ok: true, evidence, created: true };
}
