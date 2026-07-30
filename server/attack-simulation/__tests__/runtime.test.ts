import { describe, expect, it } from "vitest";
import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import {
  DEFAULT_SANDBOX_HOST_ALLOWLIST,
  assertNetworkRestrictions,
  assertRequestBudget,
  assertTargetAllowlisted,
  enforceSafeRuntimeGuards,
  networkIntentFromTarget,
} from "../runtime/guards";
import { resolveSafeRuntimeAdapter } from "../runtime/adapters";
import {
  createSafeRuntimeSession,
  executeSafeRuntimeStep,
  markSafeRuntimeEmergencyStop,
} from "../runtime/safe-runtime";
import type { SafeRuntimeGuardContext } from "../runtime/types";

function baseGuard(overrides: Partial<SafeRuntimeGuardContext> = {}): SafeRuntimeGuardContext {
  return {
    mode: "mock",
    tenant: {
      organizationId: "org-1",
      projectId: "proj-1",
      campaignId: "camp-1",
      executionId: "exec-1",
      correlationId: "corr-1",
    },
    commitSha: "abc123",
    authorization: null,
    limits: { maxRequestBudget: 5, maxDurationMs: 60_000 },
    network: { kind: "none" },
    requestsConsumed: 0,
    startedAtMs: Date.now(),
    ...overrides,
  };
}

function approvedAuth(): AttackAuthorizationRecord {
  return {
    id: "auth-1",
    organizationId: "org-1",
    projectId: "proj-1",
    targetOrigin: "https://staging.example.com",
    environmentType: "staging",
    status: "approved",
    authorizationMethod: "manual",
    approvedScope: {},
    createdBy: "user-1",
    approvedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    testCredentialsRef: null,
    pathExclusions: [],
    redirectAllowlist: [],
    maxRequestBudget: 10,
    maxDurationSeconds: 600,
    commitSha: "abc123",
  };
}

describe("safe runtime guards", () => {
  it("blocks external targets for mock mode", () => {
    const result = assertTargetAllowlisted(
      baseGuard({
        mode: "mock",
        network: { kind: "http", url: "https://evil.example.com" },
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation.code).toBe("EXTERNAL_TARGET_DISALLOWED");
  });

  it("forbids network for static runtime", () => {
    const result = assertNetworkRestrictions(
      baseGuard({
        mode: "static",
        network: { kind: "http", url: "https://localhost/api" },
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation.code).toBe("NETWORK_FORBIDDEN");
  });

  it("allows sandbox only for allowlisted hosts", () => {
    const allowed = assertNetworkRestrictions(
      baseGuard({
        mode: "sandbox",
        network: { kind: "http", url: "http://localhost:3000/api" },
      })
    );
    expect(allowed.ok).toBe(true);

    const blocked = assertNetworkRestrictions(
      baseGuard({
        mode: "sandbox",
        network: { kind: "http", url: "https://evil.example.com" },
      })
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.violation.code).toBe("SANDBOX_HOST_NOT_ALLOWLISTED");
  });

  it("requires authorization for authorized_staging targets", () => {
    const withoutAuth = assertTargetAllowlisted(
      baseGuard({
        mode: "authorized_staging",
        network: { kind: "http", url: "https://staging.example.com/login" },
      })
    );
    expect(withoutAuth.ok).toBe(false);

    const withAuth = assertTargetAllowlisted(
      baseGuard({
        mode: "authorized_staging",
        authorization: approvedAuth(),
        network: { kind: "http", url: "https://staging.example.com/login" },
      })
    );
    expect(withAuth.ok).toBe(true);
  });

  it("enforces request budget and emergency stop", () => {
    const budget = assertRequestBudget(baseGuard({ requestsConsumed: 5, limits: { maxRequestBudget: 5, maxDurationMs: 1000 } }));
    expect(budget.ok).toBe(false);

    const stop = enforceSafeRuntimeGuards(baseGuard({ emergencyStop: true }));
    expect(stop.ok).toBe(false);
    if (!stop.ok) expect(stop.violation.code).toBe("EMERGENCY_STOP");
  });

  it("maps network intent by runtime mode", () => {
    expect(networkIntentFromTarget("mock", "https://x.com").kind).toBe("fixture");
    expect(networkIntentFromTarget("sandbox", "https://x.com").kind).toBe("http");
  });
});

describe("safe runtime adapters", () => {
  it("resolves all six runtime modes", () => {
    for (const mode of ["static", "mock", "sandbox", "authorized_staging", "blocked", "unsupported"] as const) {
      expect(resolveSafeRuntimeAdapter(mode).mode).toBe(mode);
    }
  });

  it("executes mock steps without network", async () => {
    const session = createSafeRuntimeSession({
      mode: "mock",
      tenant: baseGuard().tenant,
      commitSha: "abc123",
    });
    const { result } = await executeSafeRuntimeStep(session, {
      stepKind: "execute_request",
      stepLabel: "Probe endpoint",
    });
    expect(result.outcome).toBe("completed");
    expect(result.classification).toBe("simulated");
  });

  it("blocks mock runtime when URL is present in guard", async () => {
    const session = createSafeRuntimeSession({
      mode: "mock",
      tenant: baseGuard().tenant,
      commitSha: "abc123",
      targetUrl: "https://evil.example.com",
    });
    const { result } = await executeSafeRuntimeStep(session, {
      stepKind: "execute_request",
      stepLabel: "Probe endpoint",
    });
    expect(result.outcome).toBe("blocked");
    expect(result.failureCode).toBe("EXTERNAL_TARGET_DISALLOWED");
  });

  it("blocked and unsupported adapters always return blocked", async () => {
    for (const mode of ["blocked", "unsupported"] as const) {
      const session = createSafeRuntimeSession({
        mode,
        tenant: baseGuard().tenant,
        commitSha: "abc123",
      });
      const { result } = await executeSafeRuntimeStep(session, {
        stepKind: "validate_preconditions",
        stepLabel: "Validate",
      });
      expect(result.outcome).toBe("blocked");
    }
  });

  it("honors emergency stop before step execution", async () => {
    let session = createSafeRuntimeSession({
      mode: "sandbox",
      tenant: baseGuard().tenant,
      commitSha: "abc123",
      targetUrl: "http://localhost:3000",
    });
    session = markSafeRuntimeEmergencyStop(session);
    const { result } = await executeSafeRuntimeStep(session, {
      stepKind: "execute_request",
      stepLabel: "Sandbox probe",
    });
    expect(result.outcome).toBe("blocked");
    expect(result.failureCode).toBe("EMERGENCY_STOP");
  });
});

describe("sandbox allowlist defaults", () => {
  it("includes localhost hosts", () => {
    expect(DEFAULT_SANDBOX_HOST_ALLOWLIST).toContain("localhost");
  });
});
