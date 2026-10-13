import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// SequrAI V1 does not offer dynamic security testing. The restriction lives in the SERVER, at every entry point, and holds even
// when the organization is on the "ga" rollout and the caller is an authenticated member with access to the project.
// (Deliberately does NOT import @/test/enable-dynamic-testing: this suite is about the closed default.)

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
  fetchSpy: null as unknown,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));
vi.mock("@/server/security-scanner/admin-client", () => ({ createAdminClient: () => mocks.admin }));
vi.mock("@/server/projects/project-access", () => ({
  requireProjectApiAccess: async () => ({ ok: true, project: { id: "11111111-1111-4111-8111-111111111111", organization_id: "org-a" } }),
}));
vi.mock("@/server/http/rate-limit", () => ({ enforceRateLimit: async () => null }));

import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { testMcpAuthContext } from "@/server/mcp/__tests__/test-context";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { McpError } from "@/server/mcp/auth";
import { authorizeDynamicTarget } from "@/server/mcp/tools/authorize-dynamic-target";
import { startAttackCampaign, StartAttackCampaignError } from "../start-attack-campaign";
import { tryExecuteDynamicHttpStep } from "../dynamic/execute-dynamic-step";
import { resolveDynamicTargetForAudit } from "@/server/full-product-audit/resolve-dynamic-target";
import { isDynamicSecurityTestingAvailable, DYNAMIC_TESTING_UNAVAILABLE_CODE } from "../availability";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SCAN = "22222222-2222-4222-8222-222222222222";
const ENV = "SEQURAI_DYNAMIC_SECURITY_TESTING_ENABLED";

const hypothesis = {
  id: "finding-1", title: "Missing ownership check", description: "d", category: "authorization", severity: "high", confidence: 0.8, source: "auth.authorization",
};

beforeEach(() => {
  delete process.env[ENV];
  mocks.admin = createFakeAdmin({
    attack_simulation_campaigns: [], attack_simulation_scenarios: [], attack_simulation_executions: [], attack_authorizations: [],
    projects: [{ id: PROJECT, name: "Alpha", github_repo: "acme/alpha", organization_id: "org-a" }], profiles: [],
  } as unknown as FakeTables);
  mocks.fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must not be used"));
});
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.unstubAllEnvs(); });

const campaignBody = (over: Record<string, unknown> = {}) => ({ scanId: SCAN, commitSha: "abcdef1234567", hypotheses: [hypothesis], ...over });
const tables = () => (mocks.admin as { tables?: FakeTables }).tables;

describe("availability", () => {
  it("is closed by default and opens only with the exact operator value", () => {
    expect(isDynamicSecurityTestingAvailable()).toBe(false);
    for (const value of ["", "1", "TRUE", "yes", " false "]) {
      process.env[ENV] = value;
      expect(isDynamicSecurityTestingAvailable()).toBe(false);
    }
    process.env[ENV] = "true";
    expect(isDynamicSecurityTestingAvailable()).toBe(true);
  });

  it("the attack_simulation rollout is not GA by default", async () => {
    vi.stubEnv("SEQURAI_FEATURE_FLAGS_JSON", "");
    const flags = await import("@/server/feature-flags");
    expect(flags.getFeatureRollout("attack_simulation")).toBe("internal");
    expect(flags.isFeatureEnabled("attack_simulation", { organizationId: "org-a" })).toBe(false);
  });
});

describe("service: no ungrounded hypothesis, no dynamic runtime", () => {
  it("there is no default hypothesis: a campaign without hypotheses is refused and nothing is created", async () => {
    await expect(startAttackCampaign(mocks.admin as never, { projectId: PROJECT, organizationId: "org-a", body: campaignBody({ hypotheses: undefined }) }))
      .rejects.toMatchObject({ code: "HYPOTHESES_REQUIRED" });
    await expect(startAttackCampaign(mocks.admin as never, { projectId: PROJECT, organizationId: "org-a", body: campaignBody({ hypotheses: [] }) }))
      .rejects.toBeInstanceOf(StartAttackCampaignError);
    expect(tables()?.attack_simulation_campaigns ?? []).toHaveLength(0);
  });

  it.each(["sandbox", "authorized_staging"])("%s runtime is refused", async (runtimeMode) => {
    await expect(startAttackCampaign(mocks.admin as never, { projectId: PROJECT, organizationId: "org-a", body: campaignBody({ runtimeMode, targetUrl: "https://staging.example.com" }) }))
      .rejects.toMatchObject({ code: DYNAMIC_TESTING_UNAVAILABLE_CODE, status: 403 });
    expect(tables()?.attack_simulation_campaigns ?? []).toHaveLength(0);
  });

  it("an explicit authorization record does not open it", async () => {
    await expect(startAttackCampaign(mocks.admin as never, {
      projectId: PROJECT, organizationId: "org-a",
      body: campaignBody({ runtimeMode: "authorized_staging", authorizationId: "33333333-3333-4333-8333-333333333333", targetUrl: "https://staging.example.com" }),
    })).rejects.toMatchObject({ code: DYNAMIC_TESTING_UNAVAILABLE_CODE });
  });
});

describe("executor: last line of defence sends no request", () => {
  it.each(["sandbox", "authorized_staging"] as const)("a queued %s step fails closed and sends 0 HTTP requests", async (mode) => {
    const result = await tryExecuteDynamicHttpStep({
      stepKind: "execute_request", adapterId: "security-headers-probe",
      guard: {
        mode, tenant: { organizationId: "org-a", projectId: PROJECT, correlationId: "c", campaignId: "x", executionId: "y" },
        network: { kind: "http", url: "http://localhost:4010", method: "GET" }, authorization: null,
        limits: { maxRequestBudget: 10, maxDurationMs: 10_000, maxConcurrentRequests: 1 }, requestsConsumed: 0, startedAtMs: Date.now(), cancelled: false, emergencyStop: false,
      },
    } as never);
    expect(result).toMatchObject({ outcome: "failed", failureCode: DYNAMIC_TESTING_UNAVAILABLE_CODE });
    expect(mocks.fetchSpy).not.toHaveBeenCalled();
  });
});

describe("full product audit resolves no dynamic target", () => {
  it("even with an approved staging authorization in the database", async () => {
    const result = await resolveDynamicTargetForAudit(mocks.admin as never, { organizationId: "org-a", projectId: PROJECT });
    expect(result).toMatchObject({ targetUrl: null, source: "none", authorization: null, runtimeMode: "mock" });
  });
});

describe("MCP authorize_dynamic_target", () => {
  const ctx = () => testMcpAuthContext(mocks.admin as never, { organizationId: "org-a" });
  const t = getMcpTranslator("en");

  it.each(["prepare", "check", "initiate", "verify", "approve", "authorize_and_check", "approve_scope_expansion", "manual_help"] as const)(
    "%s is refused before any outbound check or authorization is created",
    async (action) => {
      await expect(authorizeDynamicTarget(ctx(), { projectId: PROJECT, action, targetOrigin: "https://staging.example.com" }, t))
        .rejects.toMatchObject({ status: 403, code: "dynamic_testing_unavailable" });
      expect(mocks.fetchSpy).not.toHaveBeenCalled();
      expect(tables()?.attack_authorizations ?? []).toHaveLength(0);
    }
  );

  it("an unavailable action is an McpError, not a silent success", async () => {
    await expect(authorizeDynamicTarget(ctx(), { projectId: PROJECT, action: "check", targetOrigin: "https://staging.example.com" }, t)).rejects.toBeInstanceOf(McpError);
  });
});

describe("API routes answer 403 with a stable code for an authorized member on the GA rollout", () => {
  beforeEach(() => { vi.stubEnv("SEQURAI_FEATURE_FLAGS_JSON", JSON.stringify({ attack_simulation: "ga" })); });

  const post = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const params = { params: Promise.resolve({ id: PROJECT }) };

  it("POST attack-campaigns", async () => {
    const { POST } = await import("@/app/api/projects/[id]/attack-campaigns/route");
    const response = await POST(post({ scanId: SCAN, commitSha: "abcdef1234567" }), params as never);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(DYNAMIC_TESTING_UNAVAILABLE_CODE);
    expect(tables()?.attack_simulation_campaigns ?? []).toHaveLength(0);
  });

  it("POST attack-authorizations", async () => {
    const { POST } = await import("@/app/api/projects/[id]/attack-authorizations/route");
    const response = await POST(post({ targetOrigin: "https://staging.example.com", environmentType: "staging" }), params as never);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(DYNAMIC_TESTING_UNAVAILABLE_CODE);
    expect(tables()?.attack_authorizations ?? []).toHaveLength(0);
  });

  it("POST dynamic-target-authorization", async () => {
    const { POST } = await import("@/app/api/projects/[id]/dynamic-target-authorization/route");
    const response = await POST(post({ targetOrigin: "https://staging.example.com", action: "verify" }), params as never);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(DYNAMIC_TESTING_UNAVAILABLE_CODE);
  });

  it("the capability descriptor does not advertise dynamic runtimes", async () => {
    const { buildAttackCenterCapability } = await import("../api/attack-center-contract");
    const capability = buildAttackCenterCapability({ organizationId: "org-a" });
    expect(capability).toMatchObject({ enabled: true, dynamicTestingAvailable: false });
    expect(capability.runtimeModes).not.toContain("sandbox");
    expect(capability.runtimeModes).not.toContain("authorized_staging");
  });
});
