import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDynamicSecurityLab, type DynamicSecurityLab } from "@/fixtures/dynamic-security-lab/server";
import { createSafeRuntimeSession, executeSafeRuntimeStep } from "@/server/attack-simulation/runtime/safe-runtime";
import { evaluateAttackOutcome } from "@/server/attack-simulation/mitigation/evaluate-outcome";
import { DYNAMIC_CAPABLE_ADAPTER_IDS } from "@/server/attack-simulation/dynamic/probes";

let lab: DynamicSecurityLab;

beforeAll(async () => {
  lab = await startDynamicSecurityLab();
});

afterAll(async () => {
  await lab.close();
});

const tenant = {
  organizationId: "66666666-6666-4666-8666-666666666666",
  projectId: "55555555-5555-4555-8555-555555555555",
  campaignId: "11111111-1111-4111-8111-111111111111",
  executionId: "22222222-2222-4222-8222-222222222222",
  correlationId: "33333333-3333-4333-8333-333333333333",
};

async function runDynamicAdapter(adapterId: string) {
  const session = createSafeRuntimeSession({
    mode: "sandbox",
    tenant,
    commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
    targetUrl: lab.origin,
  });

  const { result } = await executeSafeRuntimeStep(session, {
    adapterId,
    stepKind: "execute_request",
    stepLabel: "Execute request",
  });

  const evaluation = evaluateAttackOutcome({
    evidence: {
      confidence: 0.9,
      expectedBehavior: "Secure behavior under authorized dynamic probe",
      observedBehavior: result.observedBehavior,
      sideEffects: result.sideEffects ?? {},
      statusCode: result.statusCode ?? null,
    },
    scenario: { adapterId, title: adapterId, category: "security" },
    runtimeMode: "sandbox",
  });

  return { result, evaluation };
}

describe("dynamic HTTP security probes against local lab", () => {
  it("executes real HTTP requests with dynamic evidence metadata", async () => {
    const { result } = await runDynamicAdapter("unauthenticated-endpoint");
    expect(result.sideEffects?.dynamic).toBe(true);
    expect(result.sideEffects?.httpRequestsSent).toBeGreaterThan(0);
    expect(result.observedBehavior.toLowerCase()).toContain("unauthenticated");
  });

  it("confirms unauthenticated endpoint exposure", async () => {
    const { evaluation } = await runDynamicAdapter("unauthenticated-endpoint");
    expect(evaluation.outcome).toBe("confirmed");
  });

  it("confirms IDOR when user A reads user B resource", async () => {
    const { evaluation } = await runDynamicAdapter("idor-cross-tenant");
    expect(evaluation.outcome).toBe("confirmed");
  });

  it("confirms missing rate limiting on vulnerable login endpoint", async () => {
    const { evaluation } = await runDynamicAdapter("rate-limit-brute-force");
    expect(evaluation.outcome).toBe("confirmed");
  });

  it("marks protected webhook validation as not exploitable", async () => {
    const { evaluation } = await runDynamicAdapter("webhook-signature-bypass");
    expect(evaluation.outcome).toBe("not_exploitable");
  });

  it("marks idempotency replay as not exploitable when deduplicated", async () => {
    const { evaluation } = await runDynamicAdapter("idempotency-replay");
    expect(evaluation.outcome).toBe("not_exploitable");
  });

  it("confirms mass assignment when privileged field is accepted", async () => {
    const { evaluation } = await runDynamicAdapter("mass-assignment-probe");
    expect(evaluation.outcome).toBe("confirmed");
  });

  it("marks privilege escalation as not exploitable for standard user", async () => {
    const { evaluation } = await runDynamicAdapter("privilege-escalation");
    expect(evaluation.outcome).toBe("not_exploitable");
  });

  it("confirms CORS misconfiguration from real preflight response", async () => {
    const { evaluation } = await runDynamicAdapter("cors-misconfiguration");
    expect(evaluation.outcome).toBe("confirmed");
  });

  it("confirms missing security headers from real HTTP response", async () => {
    const { evaluation } = await runDynamicAdapter("security-headers-probe");
    expect(evaluation.outcome).toBe("confirmed");
  });

  it("confirms safe injection probe reflection", async () => {
    const { evaluation } = await runDynamicAdapter("injection-probe-safe");
    expect(evaluation.outcome).toBe("confirmed");
  });

  it("marks blocked SSRF probe as not exploitable", async () => {
    const { evaluation } = await runDynamicAdapter("ssrf-probe-safe");
    expect(evaluation.outcome).toBe("not_exploitable");
  });

  it("keeps mock mode on simulated adapters without target URL", async () => {
    const session = createSafeRuntimeSession({
      mode: "mock",
      tenant,
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
      targetUrl: null,
    });
    const { result } = await executeSafeRuntimeStep(session, {
      adapterId: "unauthenticated-endpoint",
      stepKind: "execute_request",
      stepLabel: "Execute request",
    });
    expect(result.sideEffects?.dynamic).toBeUndefined();
    expect(result.observedBehavior.toLowerCase()).toContain("without authentication");
  });

  it("registers dynamic capability on all priority adapters", () => {
    for (const adapterId of [
      "unauthenticated-endpoint",
      "idor-cross-tenant",
      "webhook-signature-bypass",
      "rate-limit-brute-force",
      "idempotency-replay",
      "mass-assignment-probe",
      "privilege-escalation",
      "security-headers-probe",
      "injection-probe-safe",
      "ssrf-probe-safe",
      "cors-misconfiguration",
    ]) {
      expect(DYNAMIC_CAPABLE_ADAPTER_IDS.has(adapterId)).toBe(true);
    }
  });
});
