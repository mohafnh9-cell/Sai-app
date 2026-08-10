/**
 * Real Dynamic Validation — proves network I/O, authorization gates, evidence,
 * correlation, and fix/re-test for the first three dynamic adapters.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDynamicSecurityLab, type DynamicSecurityLab } from "@/fixtures/dynamic-security-lab/server";
import { createSafeRuntimeSession, executeSafeRuntimeStep } from "@/server/attack-simulation/runtime/safe-runtime";
import { evaluateAttackOutcome } from "@/server/attack-simulation/mitigation/evaluate-outcome";
import { correlateAuditFindings } from "@/server/full-product-audit/correlate-findings";
import { selectAttacksFromFindings } from "@/server/full-product-audit/select-attacks-from-findings";
import { compareAuditForPostFix } from "@/server/full-product-audit/post-fix-validation";
import { authorizationForSandboxOrigin } from "@/server/attack-simulation/dynamic/http-client";
import type { DynamicTargetFixtures } from "@/server/attack-simulation/dynamic/authorized-target";

let lab: DynamicSecurityLab;

const tenant = {
  organizationId: "66666666-6666-4666-8666-666666666666",
  projectId: "55555555-5555-4555-8555-555555555555",
  campaignId: "11111111-1111-4111-8111-111111111111",
  executionId: "22222222-2222-4222-8222-222222222222",
  correlationId: "33333333-3333-4333-8333-333333333333",
};

async function runAdapter(
  adapterId: string,
  options?: {
    targetUrl?: string;
    mode?: "sandbox" | "mock" | "authorized_staging";
    fixtures?: DynamicTargetFixtures;
    authorization?: ReturnType<typeof authorizationForSandboxOrigin> | null;
  }
) {
  const session = createSafeRuntimeSession({
    mode: options?.mode ?? "sandbox",
    tenant,
    commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
    targetUrl: options?.targetUrl ?? lab.origin,
    authorization: options?.authorization ?? null,
  });

  const { result } = await executeSafeRuntimeStep(session, {
    adapterId,
    stepKind: "execute_request",
    stepLabel: "Execute request",
    fixtures: options?.fixtures,
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
    runtimeMode: options?.mode ?? "sandbox",
  });

  return { result, evaluation };
}

function evidenceFrom(result: Awaited<ReturnType<typeof runAdapter>>["result"]) {
  const unauth = result.sideEffects?.unauthenticated as Record<string, unknown> | undefined;
  const response = result.sideEffects?.response as Record<string, unknown> | undefined;
  const sample = (unauth ?? response ?? {}) as Record<string, unknown>;
  return {
    endpoint: sample.endpoint,
    method: sample.method,
    status: sample.status,
    durationMs: sample.durationMs,
    correlationId: tenant.correlationId,
    timestamp: sample.timestamp,
    targetHostname: result.sideEffects?.targetHostname,
    httpRequestsSent: result.sideEffects?.httpRequestsSent,
    bodyPreview: sample.bodyPreview,
  };
}

describe("REAL DYNAMIC VALIDATION — Phase 1-10", () => {
  beforeAll(async () => {
    delete process.env.SEQURAI_LAB_PROTECT_PUBLIC_PROFILE;
    lab = await startDynamicSecurityLab();
    process.env.SEQURAI_DYNAMIC_LAB_ORIGIN = lab.origin;
  });

  afterAll(async () => {
    delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
    delete process.env.SEQURAI_LAB_PROTECT_PUBLIC_PROFILE;
    await lab.close();
  });

  it("Phase 1 — lab starts and exposes known endpoints", async () => {
    const response = await fetch(`${lab.origin}/`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ lab: "dynamic-security-lab" });
    expect(lab.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("Phase 2 — proves real HTTP network I/O against running lab", async () => {
    const startedAt = new Date().toISOString();
    const response = await fetch(`${lab.origin}/api/public/profile`);
    const finishedAt = new Date().toISOString();
    const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sensitive).toBe(true);
    expect(durationMs).toBeGreaterThanOrEqual(0);

    const proof = {
      method: "GET",
      url: `${lab.origin}/api/public/profile`,
      startedAt,
      finishedAt,
      status: response.status,
      durationMs,
      correlationId: tenant.correlationId,
      serverProof: body.lab ?? "dynamic-security-lab-response",
    };
    expect(proof.status).toBe(200);
  });

  it("Phase 3A — mock mode without target performs no dynamic HTTP", async () => {
    const { result } = await runAdapter("unauthenticated-endpoint", {
      mode: "mock",
      targetUrl: null,
    });
    expect(result.sideEffects?.dynamic).toBeUndefined();
    expect(result.sideEffects?.httpRequestsSent).toBeUndefined();
  });

  it("Phase 3B — authorized sandbox executes real HTTP", async () => {
    const { result } = await runAdapter("unauthenticated-endpoint");
    expect(result.sideEffects?.dynamic).toBe(true);
    expect(result.sideEffects?.httpRequestsSent).toBeGreaterThan(0);
  });

  it("Phase 3C — unauthorized external host is blocked before network", async () => {
    const { result } = await runAdapter("unauthenticated-endpoint", {
      targetUrl: "https://evil.example.com",
    });
    expect(result.outcome).toBe("blocked");
    expect(result.failureCode).toBe("SANDBOX_HOST_NOT_ALLOWLISTED");
    expect(result.sideEffects?.httpRequestsSent).toBeUndefined();
  });

  it("Phase 3D — out-of-scope path is blocked for authorized staging", async () => {
    const auth = {
      ...authorizationForSandboxOrigin(lab.origin),
      organizationId: tenant.organizationId,
      projectId: tenant.projectId,
    };
    const { result } = await runAdapter("unauthenticated-endpoint", {
      mode: "authorized_staging",
      authorization: auth,
      fixtures: {
        paths: { unauthenticated: "/admin/secret" },
      },
    });
    expect(["blocked", "failed"]).toContain(result.outcome);
    expect(String(result.observedBehavior)).toMatch(/outside authorized scope|excluded|allowlist|Path/i);
  });

  it("Phase 4 — unauthenticated-endpoint CONFIRMED with real evidence", async () => {
    const { result, evaluation } = await runAdapter("unauthenticated-endpoint");
    expect(evaluation.outcome).toBe("confirmed");

    const unauth = result.sideEffects?.unauthenticated as Record<string, unknown>;
    const auth = result.sideEffects?.authenticatedComparison as Record<string, unknown>;
    expect(unauth?.status).toBe(200);
    expect(auth?.status).toBe(200);

    const proof = evidenceFrom(result);
    expect(proof.endpoint).toContain("/api/public/profile");
    expect(proof.method).toBe("GET");
    expect(proof.httpRequestsSent).toBeGreaterThan(1);
    expect(String(proof.bodyPreview)).not.toMatch(/Bearer|test-token/i);
  });

  it("Phase 5 — IDOR CONFIRMED when User A reads User B resource", async () => {
    const own = await runAdapter("idor-cross-tenant", {
      fixtures: { paths: { idorResourceB: "/api/orders/user-a" } },
    });
    expect(own.evaluation.outcome).not.toBe("confirmed");

    const { result, evaluation } = await runAdapter("idor-cross-tenant");
    expect(evaluation.outcome).toBe("confirmed");
    expect(result.observedBehavior.toLowerCase()).toContain("cross-tenant");

    const proof = evidenceFrom(result);
    expect(proof.endpoint).toContain("/api/orders/user-b");
    expect(proof.status).toBe(200);
  });

  it("Phase 5 — protected IDOR returns NOT_EXPLOITABLE", async () => {
    const { evaluation } = await runAdapter("idor-cross-tenant", {
      fixtures: { paths: { idorResourceB: "/api/orders/user-b-protected" } },
    });
    expect(evaluation.outcome).toBe("not_exploitable");
  });

  it("Phase 6 — rate-limit CONFIRMED on vulnerable endpoint", async () => {
    const { result, evaluation } = await runAdapter("rate-limit-brute-force");
    expect(evaluation.outcome).toBe("confirmed");
    expect(result.sideEffects?.noRateLimiting).toBe(true);
    expect(result.sideEffects?.requestsSent).toBeLessThanOrEqual(12);
    expect(result.sideEffects?.requestsAccepted).toBeGreaterThan(0);
  });

  it("Phase 6 — protected rate-limit returns NOT_EXPLOITABLE", async () => {
    const { evaluation, result } = await runAdapter("rate-limit-brute-force", {
      fixtures: { paths: { rateLimitVulnerable: "/api/login-protected" } },
    });
    expect(evaluation.outcome).toBe("not_exploitable");
    expect(result.sideEffects?.requestsBlocked).toBeGreaterThan(0);
  });

  it("Phase 7 — evidence is redacted and contains HTTP metadata", async () => {
    const { result } = await runAdapter("unauthenticated-endpoint");
    const serialized = JSON.stringify(result.sideEffects ?? {});
    expect(serialized).not.toMatch(/Bearer test-token-user-a/i);
    expect(serialized).not.toContain("[REDACTED]");
    const proof = evidenceFrom(result);
    expect(proof.correlationId).toBeTruthy();
    expect(proof.timestamp).toBeTruthy();
    expect(proof.targetHostname).toBe("127.0.0.1");
  });

  it("Phase 8 — correlation CONFIRMED when static IDOR + dynamic confirmed", () => {
    const findings = correlateAuditFindings({
      staticFindings: [
        {
          id: "s-idor",
          ruleId: "authz.insufficient",
          title: "Possible IDOR",
          severity: "high",
          category: "authorization",
        },
      ],
      attackFindings: [
        {
          id: "a-idor",
          title: "Cross-tenant IDOR",
          severity: "high",
          category: "authorization",
          outcome: "confirmed",
          adapterId: "idor-cross-tenant",
        },
      ],
      executedAdapters: ["idor-cross-tenant"],
    });
    expect(findings[0]?.verificationStatus).toBe("CONFIRMED");
  });

  it("Phase 8 — correlation FALSE_POSITIVE when dynamic shows protection", () => {
    const findings = correlateAuditFindings({
      staticFindings: [
        {
          id: "s-idor",
          ruleId: "authz.insufficient",
          title: "Possible IDOR",
          severity: "high",
          category: "authorization",
        },
      ],
      attackFindings: [
        {
          id: "a-idor",
          title: "Cross-tenant IDOR",
          severity: "high",
          category: "authorization",
          outcome: "not_exploitable",
          adapterId: "idor-cross-tenant",
        },
      ],
      executedAdapters: ["idor-cross-tenant"],
    });
    expect(findings.some((f) => f.verificationStatus === "FALSE_POSITIVE")).toBe(true);
  });

  it("Phase 8 — static-only without dynamic remains POTENTIAL", () => {
    const findings = correlateAuditFindings({
      staticFindings: [
        {
          id: "s1",
          ruleId: "authz.insufficient",
          title: "Possible vulnerability",
          severity: "medium",
          category: "authorization",
        },
      ],
      attackFindings: [],
      executedAdapters: [],
    });
    expect(findings[0]?.verificationStatus).toBe("POTENTIAL");
  });

  it("Phase 8 — mock mode never produces CONFIRMED evaluation", async () => {
    const { evaluation } = await runAdapter("idor-cross-tenant", {
      mode: "mock",
      targetUrl: null,
      fixtures: { simulationOutcome: "vulnerable" },
    });
    expect(evaluation.outcome).not.toBe("confirmed");
  });

  it("Phase 5 planning — static findings select targeted adapters only", () => {
    const idorOnly = selectAttacksFromFindings({
      staticFindings: [
        {
          id: "1",
          ruleId: "authz.insufficient",
          title: "Possible IDOR",
          severity: "high",
          category: "authorization",
        },
      ],
      maxAdapters: 4,
    });
    expect(idorOnly).toContain("idor-cross-tenant");
    expect(idorOnly).not.toContain("webhook-signature-bypass");

    const authOnly = selectAttacksFromFindings({
      staticFindings: [
        {
          id: "2",
          ruleId: "auth.missing",
          title: "Missing authentication",
          severity: "high",
          category: "authentication",
        },
      ],
      maxAdapters: 4,
    });
    expect(authOnly).toContain("unauthenticated-endpoint");

    const rateOnly = selectAttacksFromFindings({
      staticFindings: [
        {
          id: "3",
          ruleId: "rate-limit.missing",
          title: "Missing rate limiting",
          severity: "high",
          category: "availability",
        },
      ],
      maxAdapters: 4,
    });
    expect(rateOnly).toContain("rate-limit-brute-force");
  });

  it("Phase 10 — fix + re-test marks FIXED after real HTTP shows protection", async () => {
    const before = await runAdapter("unauthenticated-endpoint");
    expect(before.evaluation.outcome).toBe("confirmed");

    process.env.SEQURAI_LAB_PROTECT_PUBLIC_PROFILE = "1";
    await lab.close();
    lab = await startDynamicSecurityLab(lab.port);
    process.env.SEQURAI_DYNAMIC_LAB_ORIGIN = lab.origin;

    const after = await runAdapter("unauthenticated-endpoint");
    expect(after.evaluation.outcome).toBe("not_exploitable");

    const beforeFindings = correlateAuditFindings({
      staticFindings: [
        {
          id: "s-auth",
          ruleId: "auth.missing",
          title: "Public profile without auth",
          severity: "high",
          category: "authentication",
        },
      ],
      attackFindings: [
        {
          id: "a-auth",
          title: "Unauthenticated endpoint",
          severity: "high",
          category: "authentication",
          outcome: "confirmed",
          adapterId: "unauthenticated-endpoint",
        },
      ],
      executedAdapters: ["unauthenticated-endpoint"],
    });

    const afterFindings = correlateAuditFindings({
      staticFindings: [
        {
          id: "s-auth",
          ruleId: "auth.missing",
          title: "Public profile without auth",
          severity: "high",
          category: "authentication",
        },
      ],
      attackFindings: [
        {
          id: "a-auth",
          title: "Unauthenticated endpoint",
          severity: "high",
          category: "authentication",
          outcome: "not_exploitable",
          adapterId: "unauthenticated-endpoint",
        },
      ],
      executedAdapters: ["unauthenticated-endpoint"],
    });

    const postFix = compareAuditForPostFix({
      before: beforeFindings,
      after: afterFindings,
      targetRuleIds: ["auth.missing"],
    });
    expect(postFix).toBe("FIXED");

    delete process.env.SEQURAI_LAB_PROTECT_PUBLIC_PROFILE;
    await lab.close();
    lab = await startDynamicSecurityLab();
    process.env.SEQURAI_DYNAMIC_LAB_ORIGIN = lab.origin;
  });
});
