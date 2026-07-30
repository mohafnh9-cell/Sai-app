import type { AttackCampaign } from "../contracts/attack-campaign";
import type { CreateAttackEvidenceInput } from "../contracts/attack-evidence";
import type { AttackExecution } from "../contracts/attack-execution";
import type { AttackScenario } from "../contracts/attack-scenario";
import type { AttackRuntimeMode } from "../contracts/enums";
import { redactAttackJson, redactAttackRecord, redactAttackRecords, redactAttackSecrets, redactAttackUrl } from "./redact";
import type { EvidenceCaptureBuffer, EvidenceStepCapture } from "./capture-buffer";
import { classifyEvidenceConfidence } from "./capture-buffer";

export type BuildAttackEvidenceInput = {
  campaign: Pick<
    AttackCampaign,
    "id" | "organizationId" | "projectId" | "commitSha" | "runtimeMode"
  >;
  execution: Pick<
    AttackExecution,
    "id" | "attackerProfile" | "protectedAssets" | "commitSha" | "runtimeMode"
  >;
  scenario: Pick<AttackScenario, "id" | "adapterId" | "title" | "category" | "hypothesisId">;
  buffer: EvidenceCaptureBuffer;
  targetUrl?: string | null;
  preconditions?: Record<string, unknown>;
  terminalBlocked?: boolean;
  capturedAt?: string;
};

function findStep(buffer: EvidenceCaptureBuffer, kind: string): EvidenceStepCapture | undefined {
  return buffer.steps.find((row) => row.stepKind === kind);
}

function buildRequestPayload(input: BuildAttackEvidenceInput): Record<string, unknown> {
  const execute = findStep(input.buffer, "execute_request");
  const auth = findStep(input.buffer, "authenticate_attacker");
  const url = redactAttackUrl(input.targetUrl ?? null);

  return redactAttackRecord({
    method: "GET",
    url,
    runtimeMode: input.execution.runtimeMode,
    adapterId: input.scenario.adapterId,
    attackerProfile: redactAttackJson(input.execution.attackerProfile),
    authentication: auth
      ? {
          stepLabel: auth.stepLabel,
          auditTrail: auth.runtimeResult.auditTrail,
        }
      : null,
    executeStep: execute
      ? {
          label: execute.stepLabel,
          classification: execute.runtimeResult.classification,
        }
      : null,
  });
}

function buildResponsePayload(input: BuildAttackEvidenceInput): Record<string, unknown> {
  const observe = findStep(input.buffer, "observe_response");
  const execute = findStep(input.buffer, "execute_request");
  const source = observe ?? execute;

  if (!source) {
    return redactAttackRecord({
      note: "No response step captured",
      runtimeMode: input.execution.runtimeMode,
    });
  }

  return redactAttackRecord({
    statusCode: source.runtimeResult.statusCode ?? null,
    observedBehavior: redactAttackSecrets(source.runtimeResult.observedBehavior),
    sideEffects: redactAttackJson(source.runtimeResult.sideEffects ?? {}),
    auditTrail: source.runtimeResult.auditTrail,
    classification: source.runtimeResult.classification,
  });
}

function buildSideEffects(input: BuildAttackEvidenceInput): Record<string, unknown> {
  const verify = findStep(input.buffer, "verify_side_effects");
  const merged: Record<string, unknown> = {};
  for (const row of input.buffer.steps) {
    if (row.runtimeResult.sideEffects) {
      Object.assign(merged, row.runtimeResult.sideEffects);
    }
  }
  if (verify) {
    merged.verification = {
      observedBehavior: redactAttackSecrets(verify.runtimeResult.observedBehavior),
      outcome: verify.runtimeResult.outcome,
    };
  }
  return redactAttackRecord(merged);
}

export function buildReplayInstructions(input: BuildAttackEvidenceInput): string {
  const lines = [
    `Re-run adapter ${input.scenario.adapterId} against commit ${input.execution.commitSha}.`,
    `Runtime mode: ${input.execution.runtimeMode}.`,
    `Hypothesis: ${input.scenario.hypothesisId}.`,
  ];
  if (input.targetUrl) {
    lines.push(`Target origin: ${redactAttackUrl(input.targetUrl)}`);
  }
  lines.push("Use the same execution step template and Safe Runtime guards.");
  return lines.join("\n");
}

export function buildReproducibilitySummary(input: BuildAttackEvidenceInput): string {
  const completed = input.buffer.steps.filter((row) => row.runtimeResult.outcome === "completed").length;
  return [
    `commit=${input.execution.commitSha}`,
    `adapter=${input.scenario.adapterId}`,
    `runtime=${input.execution.runtimeMode}`,
    `steps=${completed}/${input.buffer.steps.length}`,
  ].join("; ");
}

function resolveStatusCode(buffer: EvidenceCaptureBuffer): number | null {
  for (const row of [...buffer.steps].reverse()) {
    if (row.runtimeResult.statusCode != null) return row.runtimeResult.statusCode;
  }
  return null;
}

function resolveObservedBehavior(buffer: EvidenceCaptureBuffer): string {
  const execute = findStep(buffer, "execute_request");
  const observe = findStep(buffer, "observe_response");
  const source = observe ?? execute ?? buffer.steps[buffer.steps.length - 1];
  if (!source) return "No attack steps captured";
  return redactAttackSecrets(source.runtimeResult.observedBehavior);
}

function resolveExpectedBehavior(input: BuildAttackEvidenceInput): string {
  const validate = findStep(input.buffer, "validate_preconditions");
  if (validate?.runtimeResult.expectedBehavior) {
    return redactAttackSecrets(validate.runtimeResult.expectedBehavior);
  }
  return redactAttackSecrets(
    `Scenario "${input.scenario.title}" should remain protected under ${input.scenario.category} assumptions.`
  );
}

export function buildAttackEvidenceInput(input: BuildAttackEvidenceInput): CreateAttackEvidenceInput {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const confidence = classifyEvidenceConfidence({
    runtimeMode: input.execution.runtimeMode,
    stepResults: input.buffer.steps,
    terminalBlocked: input.terminalBlocked ?? false,
  });

  return {
    executionId: input.execution.id,
    campaignId: input.campaign.id,
    scenarioId: input.scenario.id,
    organizationId: input.campaign.organizationId,
    projectId: input.campaign.projectId,
    commitSha: input.execution.commitSha,
    environment: input.execution.runtimeMode as AttackRuntimeMode,
    expectedBehavior: resolveExpectedBehavior(input),
    observedBehavior: resolveObservedBehavior(input.buffer),
    redactedRequest: buildRequestPayload(input),
    redactedResponse: buildResponsePayload(input),
    statusCode: resolveStatusCode(input.buffer),
    sideEffects: buildSideEffects(input),
    preconditions: redactAttackRecord(input.preconditions ?? {}),
    attackProfile: redactAttackRecord(input.execution.attackerProfile),
    protectedAssets: redactAttackRecords(input.execution.protectedAssets),
    reproducibility: buildReproducibilitySummary(input),
    confidence,
    replayInstructions: buildReplayInstructions(input),
    capturedAt,
  };
}
