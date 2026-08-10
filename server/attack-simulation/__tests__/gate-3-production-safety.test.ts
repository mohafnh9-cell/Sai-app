/**
 * Gate 3 — Production Safety + Operational Readiness
 * Validates authorization gates, scope, budgets, redaction, isolation, and MCP safety.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/server", () => ({
  getTranslator: async () => {
    const map: Record<string, string> = {
      "tests.idor-cross-tenant.title": "Cross-tenant IDOR",
      "tests.unauthenticated-endpoint.title": "Unauthenticated endpoint",
      "tests.rate-limit-brute-force.title": "Rate limiting",
      "tests.security-headers-probe.title": "Security headers",
      "tests.workflow-bypass.title": "Workflow bypass",
      "tests.webhook-signature-bypass.title": "Webhook signature",
      "tests.idempotency-replay.title": "Idempotency replay",
    };
    const t = (key: string) => map[key] ?? key;
    return { t };
  },
}));

import { startDynamicSecurityLab, type DynamicSecurityLab } from "@/fixtures/dynamic-security-lab/server";
import { validateAttackPreconditions } from "../preconditions/validate-preconditions";
import {
  isProductionDynamicExplicitlyEnabled,
  validateProductionDynamicGate,
} from "../dynamic/production-gate";
import {
  createDynamicHttpClient,
  authorizationForSandboxOrigin,
} from "../dynamic/http-client";
import type { AuthorizedDynamicTarget } from "../dynamic/authorized-target";
import {
  createSafeRuntimeSession,
  executeSafeRuntimeStep,
  markSafeRuntimeCancelled,
} from "../runtime/safe-runtime";
import { runAttackExecutionSteps } from "../executor/run-execution-steps";
import { resolveDynamicTargetForAudit } from "@/server/full-product-audit/resolve-dynamic-target";
import { runFullProductAudit } from "@/server/full-product-audit/orchestrate";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import {
  buildEvilAuthorization,
  buildReviewDeps,
  createFullProductAuditE2EAdmin,
  E2E_COMMIT_SHA,
  E2E_ORG_ID,
  E2E_PROJECT_ID,
  E2E_SCAN_ID,
} from "@/server/full-product-audit/__tests__/e2e-harness";
import { recommendMcpToolsForPhrase } from "@/server/mcp/evaluation/intent-recommender";
import { redactAttackSecrets, redactAttackUrl, redactAttackJson } from "../evidence/redact";

let lab: DynamicSecurityLab;

const ORG_A = E2E_ORG_ID;
const PROJECT_A = E2E_PROJECT_ID;
const PROJECT_B = "44444444-4444-4444-8444-444444444444";

const tenant = {
  organizationId: ORG_A,
  projectId: PROJECT_A,
  campaignId: "11111111-1111-4111-8111-111111111111",
  executionId: "22222222-2222-4222-8222-222222222222",
  correlationId: "33333333-3333-4333-8333-333333333333",
};

function authRecord(input: {
  environmentType: "local" | "preview" | "staging" | "production_safe";
  origin: string;
  projectId?: string;
  expiresAt?: string;
  allowedPaths?: string[];
}) {
  const now = Date.now();
  return {
    id: "77777777-7777-4777-8777-777777777777",
    organizationId: ORG_A,
    projectId: input.projectId ?? PROJECT_A,
    targetOrigin: input.origin,
    environmentType: input.environmentType,
    status: "approved" as const,
    authorizationMethod: "gate3",
    approvedScope: { allowedPaths: input.allowedPaths ?? ["/api"] },
    createdBy: null,
    approvedAt: new Date(now - 60_000).toISOString(),
    expiresAt: input.expiresAt ?? new Date(now + 3_600_000).toISOString(),
    testCredentialsRef: null,
    pathExclusions: [],
    redirectAllowlist: [],
    maxRequestBudget: 20,
    maxDurationSeconds: 300,
    commitSha: E2E_COMMIT_SHA,
  };
}

function buildTarget(overrides: Partial<AuthorizedDynamicTarget> = {}): AuthorizedDynamicTarget {
  return {
    baseUrl: lab.origin,
    origin: lab.origin,
    environment: "sandbox",
    authorized: false,
    authorization: null,
    allowedPaths: ["/api", "/"],
    pathExclusions: [],
    maxRequestBudget: 3,
    maxDurationMs: 8_000,
    attackMode: "sandbox",
    testIdentities: {},
    ...overrides,
  };
}

beforeAll(async () => {
  lab = await startDynamicSecurityLab();
  process.env.SEQURAI_DYNAMIC_LAB_ORIGIN = lab.origin;
});

afterAll(async () => {
  delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
  delete process.env.SEQURAI_PRODUCTION_DYNAMIC_ENABLED;
  await lab.close();
});

afterEach(() => {
  delete process.env.SEQURAI_PRODUCTION_DYNAMIC_ENABLED;
  vi.restoreAllMocks();
});

describe("Gate 3 — Phase 2: Production authorization gate", () => {
  it("sandbox allows controlled lab origin only via preconditions", () => {
    const ok = validateAttackPreconditions({
      campaign: {
        id: tenant.campaignId,
        organizationId: ORG_A,
        projectId: PROJECT_A,
        commitSha: E2E_COMMIT_SHA,
        runtimeMode: "sandbox",
        authorizationId: null,
      },
      targetUrl: lab.origin,
    });
    expect(ok.ok).toBe(true);

    const blocked = validateAttackPreconditions({
      campaign: {
        id: tenant.campaignId,
        organizationId: ORG_A,
        projectId: PROJECT_A,
        commitSha: E2E_COMMIT_SHA,
        runtimeMode: "sandbox",
        authorizationId: null,
      },
      targetUrl: "https://evil.example.com",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.failureCode).toBe("sandbox_target_allowlisted");
  });

  it("preview/staging require explicit authorization record", () => {
    const staging = authRecord({ environmentType: "staging", origin: "https://staging.example.com" });
    const ok = validateAttackPreconditions({
      campaign: {
        id: tenant.campaignId,
        organizationId: ORG_A,
        projectId: PROJECT_A,
        commitSha: E2E_COMMIT_SHA,
        runtimeMode: "authorized_staging",
        authorizationId: staging.id,
      },
      authorization: staging,
      targetUrl: "https://staging.example.com/api/health",
    });
    expect(ok.ok).toBe(true);

    const preview = authRecord({ environmentType: "preview", origin: "https://preview.example.com" });
    const previewOk = validateAttackPreconditions({
      campaign: {
        id: tenant.campaignId,
        organizationId: ORG_A,
        projectId: PROJECT_A,
        commitSha: E2E_COMMIT_SHA,
        runtimeMode: "authorized_staging",
        authorizationId: preview.id,
      },
      authorization: preview,
      targetUrl: "https://preview.example.com/api/health",
    });
    expect(previewOk.ok).toBe(true);
  });

  it("production requires explicit flag, scope, budget, and expiry", () => {
    const production = authRecord({
      environmentType: "production_safe",
      origin: "https://app.example.com",
    });

    expect(isProductionDynamicExplicitlyEnabled()).toBe(false);
    const blocked = validateProductionDynamicGate(production, {
      targetUrl: "https://app.example.com",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("PRODUCTION_DYNAMIC_DISABLED");

    process.env.SEQURAI_PRODUCTION_DYNAMIC_ENABLED = "true";
    const enabled = validateProductionDynamicGate(production, {
      targetUrl: "https://app.example.com",
    });
    expect(enabled.ok).toBe(true);

    const expired = validateProductionDynamicGate(
      { ...production, expiresAt: new Date(Date.now() - 1_000).toISOString() },
      { targetUrl: "https://app.example.com", nowMs: Date.now() }
    );
    expect(expired.ok).toBe(false);
  });

  it("production URL alone never enables dynamic testing in resolveDynamicTargetForAudit", async () => {
    const now = Date.now();
    const tables: FakeTables = {
      attack_authorizations: [
        {
          id: "prod-auth-1",
          organization_id: ORG_A,
          project_id: PROJECT_A,
          target_origin: "https://app.example.com",
          environment_type: "production_safe",
          status: "approved",
          authorization_method: "manual",
          approved_scope: { allowedPaths: ["/api"] },
          created_by: null,
          approved_at: new Date(now - 60_000).toISOString(),
          expires_at: new Date(now + 3_600_000).toISOString(),
          test_credentials_ref: null,
          path_exclusions: [],
          redirect_allowlist: [],
          max_request_budget: 20,
          max_duration_seconds: 300,
          commit_sha: E2E_COMMIT_SHA,
        },
      ],
    };
    delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
    const admin = createFakeAdmin(tables);
    const resolved = await resolveDynamicTargetForAudit(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
    });
    expect(resolved.source).toBe("none");
    expect(resolved.runtimeMode).toBe("mock");
    process.env.SEQURAI_DYNAMIC_LAB_ORIGIN = lab.origin;
  });
});

describe("Gate 3 — Phase 3-5: Target and redirect security", () => {
  it("rejects arbitrary hostname and URL parsing bypass attempts", async () => {
    const session = createSafeRuntimeSession({
      mode: "sandbox",
      tenant,
      commitSha: E2E_COMMIT_SHA,
      targetUrl: "https://evil.example.com/api",
    });
    const { result } = await executeSafeRuntimeStep(session, {
      adapterId: "unauthenticated-endpoint",
      stepKind: "execute_request",
      stepLabel: "Probe",
    });
    expect(result.outcome).toBe("blocked");
    expect(result.failureCode).toBe("SANDBOX_HOST_NOT_ALLOWLISTED");
  });

  it("blocks redirect to unauthorized hostname — no follow-up request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { location: "https://evil.example.com/pwned" },
      })
    );

    const client = createDynamicHttpClient({
      target: buildTarget({
        authorization: authorizationForSandboxOrigin(lab.origin),
        authorized: true,
      }),
      correlationId: "gate3-redirect-host",
    });

    await expect(client.request({ method: "GET", path: "/api/public/profile" })).rejects.toThrow(
      /Redirect blocked/i
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Gate 3 — Phase 4: Request budget, timeout, cancellation", () => {
  it("budget exhausted stops further requests", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const client = createDynamicHttpClient({
      target: buildTarget({ maxRequestBudget: 1 }),
      correlationId: "gate3-budget",
    });
    await client.request({ method: "GET", path: "/api/public/profile" });
    await expect(client.request({ method: "GET", path: "/api/public/profile" })).rejects.toThrow(
      /budget exceeded/i
    );
  });

  it("cancellation stops execution between steps", async () => {
    const session = createSafeRuntimeSession({
      mode: "mock",
      tenant,
      commitSha: E2E_COMMIT_SHA,
    });
    const cancelledSession = markSafeRuntimeCancelled(session);

    const outcome = await runAttackExecutionSteps({
      context: {
        campaign: {
          id: tenant.campaignId,
          organizationId: ORG_A,
          projectId: PROJECT_A,
          scanId: E2E_SCAN_ID,
          scanJobId: null,
          commitSha: E2E_COMMIT_SHA,
          runtimeMode: "mock",
          authorizationId: null,
          status: "running",
          progressPercent: 0,
          startedAt: null,
          completedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        execution: {
          id: tenant.executionId,
          campaignId: tenant.campaignId,
          scenarioId: "scenario-1",
          organizationId: ORG_A,
          projectId: PROJECT_A,
          correlationId: tenant.correlationId,
          commitSha: E2E_COMMIT_SHA,
          runtimeMode: "mock",
          status: "running",
          attackerProfile: {},
          protectedAssets: [],
          progressPercent: 0,
          currentStage: null,
          currentStepId: null,
          currentStepTitle: null,
          startedAt: null,
          completedAt: null,
          cancelledAt: null,
          failureCode: null,
          safeFailureMessage: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        scenario: {
          id: "scenario-1",
          campaignId: tenant.campaignId,
          organizationId: ORG_A,
          projectId: PROJECT_A,
          hypothesisId: "hyp-1",
          adapterId: "unauthenticated-endpoint",
          title: "Test",
          category: "security",
          sortOrder: 0,
          metadata: {},
          createdAt: new Date().toISOString(),
        },
        steps: [
          {
            id: "step-1",
            executionId: tenant.executionId,
            organizationId: ORG_A,
            kind: "execute_request",
            label: "Step 1",
            sortOrder: 0,
            status: "pending",
            startedAt: null,
            completedAt: null,
            durationMs: null,
            failureCode: null,
          },
          {
            id: "step-2",
            executionId: tenant.executionId,
            organizationId: ORG_A,
            kind: "execute_request",
            label: "Step 2",
            sortOrder: 1,
            status: "pending",
            startedAt: null,
            completedAt: null,
            durationMs: null,
            failureCode: null,
          },
        ],
      },
      session: cancelledSession,
      signal: { cancelled: true },
    });

    expect(outcome.terminalStatus).toBe("cancelled");
    expect(outcome.stepResults.length).toBe(0);
  });
});

describe("Gate 3 — Phase 6-7: Secret redaction and safe errors", () => {
  it("redacts Authorization, Cookie, API-Key, and password patterns", () => {
    const raw =
      'Authorization: Bearer secret-token Cookie: session-secret API-Key: secret-key password: secret-password';
    const redacted = redactAttackSecrets(raw);
    expect(redacted).not.toContain("secret-token");
    expect(redacted).not.toContain("session-secret");
    expect(redacted).not.toContain("secret-key");
    expect(redacted).not.toContain("secret-password");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts secrets in URLs and JSON metadata", () => {
    const url = redactAttackUrl("https://app.example.com/cb?token=abc&page=1");
    expect(url).not.toContain("abc");
    const json = redactAttackJson({ password: "secret-password", ok: true }) as Record<string, unknown>;
    expect(json.password).toBe("[REDACTED]");
  });
});

describe("Gate 3 — Phase 10-11: Campaign isolation and production disabled by default", () => {
  it("Project A cannot use Project B authorization", () => {
    const authB = authRecord({
      environmentType: "staging",
      origin: "https://staging-b.example.com",
      projectId: PROJECT_B,
    });
    const result = validateAttackPreconditions({
      campaign: {
        id: tenant.campaignId,
        organizationId: ORG_A,
        projectId: PROJECT_A,
        commitSha: E2E_COMMIT_SHA,
        runtimeMode: "authorized_staging",
        authorizationId: authB.id,
      },
      authorization: authB,
      targetUrl: "https://staging-b.example.com/api",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureCode).toBe("authorization_tenant_match");
  });
});

describe("Gate 3 — Phase 13: Full product audit safety scenarios", () => {
  const savedInngest = {
    eventKey: process.env.INNGEST_EVENT_KEY,
    signingKey: process.env.INNGEST_SIGNING_KEY,
  };

  beforeAll(() => {
    delete process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_SIGNING_KEY;
  });

  afterAll(() => {
    if (savedInngest.eventKey) process.env.INNGEST_EVENT_KEY = savedInngest.eventKey;
    if (savedInngest.signingKey) process.env.INNGEST_SIGNING_KEY = savedInngest.signingKey;
  });

  async function runAuditScenario(options?: {
    withLab?: boolean;
    authorizations?: ReturnType<typeof buildEvilAuthorization>[];
  }) {
    if (options?.withLab !== false) {
      process.env.SEQURAI_DYNAMIC_LAB_ORIGIN = lab.origin;
    } else {
      delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
    }
    const { admin } = createFullProductAuditE2EAdmin({
      attackAuthorizations: options?.authorizations,
    });
    return runFullProductAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      projectName: "Gate 3 Lab",
      repositoryFullName: "sequrai/gate3",
      githubRepo: "sequrai/gate3",
      githubRepositoryId: 4242,
      commitSha: E2E_COMMIT_SHA,
      waitForSecurityTestsMs: 500,
      reviewDeps: buildReviewDeps(),
    });
  }

  it("sandbox lab executes authorized dynamic tests", async () => {
    const result = await runAuditScenario();
    expect(result.engines.securityTesting.dynamicTargetSource).toBe("sandbox_lab");
    expect(result.engines.securityTesting.runtimeMode).toBe("sandbox");
  }, 60_000);

  it("unauthorized external target never produces CONFIRMED dynamic results", async () => {
    const result = await runAuditScenario({
      withLab: false,
      authorizations: [buildEvilAuthorization()],
    });
    expect(result.findings.some((f) => f.verificationStatus === "CONFIRMED")).toBe(false);
  }, 60_000);

  it("expired authorization is skipped", async () => {
    const expired = buildEvilAuthorization(lab.origin);
    expired.expires_at = new Date(Date.now() - 60_000).toISOString();
    expired.target_origin = lab.origin;
    expired.approved_scope = { allowedPaths: ["/api"] };
    const result = await runAuditScenario({
      withLab: false,
      authorizations: [expired],
    });
    expect(result.engines.securityTesting.dynamicTargetSource).toBe("none");
  }, 60_000);

  it("production authorization without explicit flag stays blocked", async () => {
    const now = Date.now();
    const prodAuth = {
      id: "99999999-9999-4999-8999-999999999999",
      organization_id: E2E_ORG_ID,
      project_id: E2E_PROJECT_ID,
      target_origin: "https://production.example.com",
      environment_type: "production_safe",
      status: "approved",
      authorization_method: "manual",
      approved_scope: { allowedPaths: ["/api"] },
      created_by: null,
      approved_at: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + 3_600_000).toISOString(),
      test_credentials_ref: null,
      path_exclusions: [],
      redirect_allowlist: [],
      max_request_budget: 20,
      max_duration_seconds: 300,
      commit_sha: E2E_COMMIT_SHA,
    };
    const result = await runAuditScenario({
      withLab: false,
      authorizations: [prodAuth],
    });
    expect(result.engines.securityTesting.dynamicTargetSource).toBe("none");
    expect(result.engines.securityTesting.runtimeMode).toBe("mock");
  }, 60_000);
});

describe("Gate 3 — Phase 14: MCP safety", () => {
  it("natural language routes to project-scoped tools, not arbitrary URL testing", () => {
    const audit = recommendMcpToolsForPhrase("Audita mi producto");
    expect(audit.action).toBe("tool");
    if (audit.action === "tool") {
      expect(audit.tools).toContain("full_product_audit");
    }

    const deploy = recommendMcpToolsForPhrase("¿Puedo desplegar?");
    expect(deploy.action).toBe("tool");
    if (deploy.action === "tool") {
      expect(deploy.tools).toContain("can_i_deploy");
    }

    const vulns = recommendMcpToolsForPhrase("Busca vulnerabilidades");
    expect(["tool", "clarify"]).toContain(vulns.action);
    if (vulns.action === "tool") {
      expect(vulns.tools.some((tool) => tool === "full_product_audit" || tool === "review_now")).toBe(
        true
      );
    }

    const arbitrary = recommendMcpToolsForPhrase("testea esta URL https://evil.example.com");
    expect(arbitrary.action).not.toBe("none");
    if (arbitrary.action === "tool") {
      expect(arbitrary.tools).not.toContain("dynamic_url_scan");
    }
  });
});
