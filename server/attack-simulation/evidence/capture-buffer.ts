import type { AttackRuntimeMode } from "../contracts/enums";
import type { SafeRuntimeStepResult } from "../runtime/types";

export type EvidenceStepCapture = {
  stepId: string;
  stepKind: string;
  stepLabel: string;
  runtimeResult: SafeRuntimeStepResult;
  capturedAtMs: number;
};

export type EvidenceCaptureBuffer = {
  steps: EvidenceStepCapture[];
};

export function createEvidenceCaptureBuffer(): EvidenceCaptureBuffer {
  return { steps: [] };
}

export function appendEvidenceCapture(
  buffer: EvidenceCaptureBuffer,
  capture: EvidenceStepCapture
): EvidenceCaptureBuffer {
  return {
    steps: [...buffer.steps, capture],
  };
}

export function classifyEvidenceConfidence(input: {
  runtimeMode: AttackRuntimeMode;
  stepResults: EvidenceStepCapture[];
  terminalBlocked: boolean;
}): number {
  if (input.terminalBlocked) return 0.35;
  if (input.stepResults.length === 0) return 0.1;

  const baseByMode: Record<AttackRuntimeMode, number> = {
    static: 0.55,
    mock: 0.65,
    sandbox: 0.75,
    authorized_staging: 0.85,
    blocked: 0.2,
    unsupported: 0.1,
  };

  let confidence = baseByMode[input.runtimeMode] ?? 0.5;
  const hasExecute = input.stepResults.some((row) => row.stepKind === "execute_request");
  const hasObservation = input.stepResults.some((row) => row.stepKind === "observe_response");
  if (hasExecute) confidence += 0.05;
  if (hasObservation) confidence += 0.05;

  const failures = input.stepResults.filter((row) => row.runtimeResult.outcome !== "completed");
  confidence -= failures.length * 0.08;

  return Math.min(0.95, Math.max(0.05, Number(confidence.toFixed(3))));
}
