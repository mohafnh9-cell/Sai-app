import { describe, expect, it } from "vitest";
import {
  appendEvidenceCapture,
  classifyEvidenceConfidence,
  createEvidenceCaptureBuffer,
} from "../evidence/capture-buffer";
import { buildAttackEvidenceInput } from "../evidence/build-evidence";
import type { SafeRuntimeStepResult } from "../runtime/types";

function runtimeResult(overrides: Partial<SafeRuntimeStepResult> = {}): SafeRuntimeStepResult {
  return {
    outcome: "completed",
    classification: "simulated",
    observedBehavior: "Simulated response",
    expectedBehavior: "Protected behavior",
    statusCode: 200,
    sideEffects: { simulated: true },
    auditTrail: ["simulated:step"],
    durationMs: 2,
    ...overrides,
  };
}

describe("attack evidence builder", () => {
  const baseInput = {
    campaign: {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "66666666-6666-4666-8666-666666666666",
      projectId: "55555555-5555-4555-8555-555555555555",
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
      runtimeMode: "mock" as const,
    },
    execution: {
      id: "22222222-2222-4222-8222-222222222222",
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
      runtimeMode: "mock" as const,
      attackerProfile: { role: "simulated_attacker" },
      protectedAssets: [{ type: "record", id: "tenant-resource" }],
    },
    scenario: {
      id: "44444444-4444-4444-8444-444444444444",
      adapterId: "idor-cross-tenant",
      title: "Cross-tenant IDOR",
      category: "authorization",
      hypothesisId: "hyp-1",
    },
    targetUrl: "https://staging.example.com/api/items?token=secret",
    preconditions: { runtimeMode: "mock" },
  };

  it("builds redacted evidence from captured steps", () => {
    let buffer = createEvidenceCaptureBuffer();
    buffer = appendEvidenceCapture(buffer, {
      stepId: "step-1",
      stepKind: "validate_preconditions",
      stepLabel: "Validate preconditions",
      runtimeResult: runtimeResult(),
      capturedAtMs: Date.now(),
    });
    buffer = appendEvidenceCapture(buffer, {
      stepId: "step-2",
      stepKind: "execute_request",
      stepLabel: "Execute request",
      runtimeResult: runtimeResult({ observedBehavior: "Returned tenant B record" }),
      capturedAtMs: Date.now(),
    });

    const evidence = buildAttackEvidenceInput({ ...baseInput, buffer });
    expect(evidence.executionId).toBe(baseInput.execution.id);
    expect(evidence.confidence).toBeGreaterThan(0.5);
    expect(evidence.redactedRequest.url).not.toContain("secret");
    expect(evidence.redactedResponse.observedBehavior).toContain("tenant B record");
    expect(evidence.replayInstructions).toContain("idor-cross-tenant");
    expect(evidence.reproducibility).toContain("adapter=idor-cross-tenant");
  });

  it("lowers confidence for blocked terminal runs", () => {
    const buffer = appendEvidenceCapture(createEvidenceCaptureBuffer(), {
      stepId: "step-1",
      stepKind: "execute_request",
      stepLabel: "Execute request",
      runtimeResult: runtimeResult({ outcome: "blocked", failureCode: "NETWORK_FORBIDDEN" }),
      capturedAtMs: Date.now(),
    });

    const blockedConfidence = classifyEvidenceConfidence({
      runtimeMode: "mock",
      stepResults: buffer.steps,
      terminalBlocked: true,
    });
    const normalConfidence = classifyEvidenceConfidence({
      runtimeMode: "mock",
      stepResults: buffer.steps,
      terminalBlocked: false,
    });

    expect(blockedConfidence).toBeLessThan(normalConfidence);
  });
});
