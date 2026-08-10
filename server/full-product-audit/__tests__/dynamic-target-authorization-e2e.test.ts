import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { startDynamicSecurityLab, type DynamicSecurityLab } from "@/fixtures/dynamic-security-lab/server";
import { resolveDynamicTargetForAudit } from "@/server/full-product-audit/resolve-dynamic-target";
import { runFullProductAudit } from "@/server/full-product-audit/orchestrate";
import { formatFullProductAuditResponse } from "@/server/full-product-audit/format-response";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { authorizeDynamicTarget } from "@/server/mcp/tools/authorize-dynamic-target";
import { assertPathAllowed } from "@/server/attack-simulation/dynamic/authorized-target";
import { resolveAuthorizedDynamicTarget } from "@/server/attack-simulation/dynamic/authorized-target";
import {
  approveDynamicTargetAuthorization,
  initiateDynamicTargetVerification,
  verifyDynamicTargetOwnership,
} from "@/server/ai-red-team/authorization/dynamic-target-authorization-service";
import {
  buildReviewDeps,
  createFullProductAuditE2EAdmin,
  E2E_COMMIT_SHA,
  E2E_ORG_ID,
  E2E_PROJECT_ID,
} from "@/server/full-product-audit/__tests__/e2e-harness";

vi.mock("@/lib/i18n/server", () => ({
  getTranslator: async () => {
    const t = (key: string) => key;
    return { t };
  },
}));

vi.mock("@/server/ai-red-team/authorization/target-verification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai-red-team/authorization/target-verification")>();
  return {
    ...actual,
    verifyTargetOwnershipHttp: vi.fn(async (_origin: string, token: string) =>
      token.startsWith("sequrai-verify-") ? { ok: true as const } : { ok: false as const, reason: "token_mismatch" }
    ),
    verifyTargetOwnershipDns: vi.fn(async () => ({ ok: false as const, reason: "dns_lookup_failed" })),
  };
});

const OTHER_PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const t = getMcpTranslator("en");

let lab: DynamicSecurityLab;

beforeAll(async () => {
  delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
  lab = await startDynamicSecurityLab();
});

afterAll(async () => {
  delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
  await lab.close();
});

beforeEach(() => {
  delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
  delete process.env.SEQURAI_PRODUCTION_DYNAMIC_ENABLED;
});

function mcpCtx(admin: ReturnType<typeof createFakeAdmin>) {
  return {
    admin: admin as never,
    organizationId: E2E_ORG_ID,
    userId: "user-1",
    apiKeyId: "key-1",
  };
}

function buildApprovedAuthorization(origin: string, projectId = E2E_PROJECT_ID) {
  const now = Date.now();
  return {
    id: "77777777-7777-4777-8777-777777777777",
    organization_id: E2E_ORG_ID,
    project_id: projectId,
    target_origin: origin,
    environment_type: "staging",
    status: "approved",
    authorization_method: "domain_verified_staging",
    approved_scope: { allowedPaths: ["/api", "/health", "/secure-headers"] },
    created_by: "user-1",
    approved_at: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 3_600_000).toISOString(),
    test_credentials_ref: null,
    path_exclusions: [],
    redirect_allowlist: [],
    max_request_budget: 50,
    max_duration_seconds: 300,
    commit_sha: null,
  };
}

describe("dynamic target authorization flow", () => {
  it("TEST 2 — no authorization → static runs, dynamic skipped (mock)", async () => {
    const { admin } = createFullProductAuditE2EAdmin();
    const result = await runFullProductAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      projectName: "No Auth Project",
      repositoryFullName: "sequrai/no-auth",
      githubRepo: "sequrai/no-auth",
      githubRepositoryId: 1,
      commitSha: E2E_COMMIT_SHA,
      waitForReviewMs: 500,
      waitForSecurityTestsMs: 500,
      reviewDeps: buildReviewDeps(),
    });

    expect(result.engines.securityTesting.runtimeMode).toBe("mock");
    expect(result.engines.securityTesting.dynamicTargetSource).toBe("none");
    const formatted = formatFullProductAuditResponse(result, t);
    expect(formatted.summary.toLowerCase()).toContain("dynamic tests were not authorized");
  });

  it("TEST 3 — user URL without authorization does not enable dynamic testing", async () => {
    const admin = createFakeAdmin({
      attack_authorizations: [],
      dynamic_target_verifications: [],
    });
    const resolved = await resolveDynamicTargetForAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
    });
    expect(resolved.source).toBe("none");
    expect(resolved.targetUrl).toBeNull();
    expect(resolved.runtimeMode).toBe("mock");
  });

  it("TEST 4 — verified domain + approved authorization enables authorized_staging", async () => {
    const origin = lab.origin;
    const admin = createFakeAdmin({
      attack_authorizations: [buildApprovedAuthorization(origin)],
      dynamic_target_verifications: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          organization_id: E2E_ORG_ID,
          project_id: E2E_PROJECT_ID,
          target_origin: origin,
          verification_token: "sequrai-verify-test",
          verification_method: "http",
          status: "verified",
          created_by: "user-1",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          verified_at: new Date().toISOString(),
        },
      ],
    });

    const resolved = await resolveDynamicTargetForAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
    });

    expect(resolved.source).toBe("authorization");
    expect(resolved.runtimeMode).toBe("authorized_staging");
    expect(resolved.targetUrl).toBe(origin);
    expect(admin.from("attack_authorizations")).toBeTruthy();
  });

  it("TEST 5 — expired authorization is ignored", async () => {
    const expired = buildApprovedAuthorization(lab.origin);
    expired.expires_at = new Date(Date.now() - 60_000).toISOString();
    const admin = createFakeAdmin({ attack_authorizations: [expired] });
    const resolved = await resolveDynamicTargetForAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
    });
    expect(resolved.source).toBe("none");
    expect(resolved.runtimeMode).toBe("mock");
  });

  it("does not reuse a Production authorization as an authorized Preview target", async () => {
    const production = {
      ...buildApprovedAuthorization("https://app.example.com"),
      environment_type: "production_safe",
    };
    const admin = createFakeAdmin({ attack_authorizations: [production] });

    const resolved = await resolveDynamicTargetForAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
    });

    expect(resolved.source).toBe("none");
    expect(resolved.authorization).toBeNull();
    expect(resolved.runtimeMode).toBe("mock");
  });

  it("TEST 6 — authorization for another project is not used", async () => {
    const admin = createFakeAdmin({
      attack_authorizations: [buildApprovedAuthorization(lab.origin, OTHER_PROJECT_ID)],
    });
    const resolved = await resolveDynamicTargetForAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
    });
    expect(resolved.source).toBe("none");
  });

  it("TEST 7 — out-of-scope path is blocked before network", () => {
    const target = resolveAuthorizedDynamicTarget({
      guard: {
        mode: "authorized_staging",
        authorization: {
          id: "auth-1",
          organizationId: E2E_ORG_ID,
          projectId: E2E_PROJECT_ID,
          targetOrigin: lab.origin,
          environmentType: "staging",
          status: "approved",
          authorizationMethod: "domain_verified_staging",
          approvedScope: { allowedPaths: ["/api"] },
          createdBy: null,
          approvedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          testCredentialsRef: null,
          pathExclusions: [],
          redirectAllowlist: [],
          maxRequestBudget: 50,
          maxDurationSeconds: 300,
          commitSha: null,
        },
        tenant: { organizationId: E2E_ORG_ID, projectId: E2E_PROJECT_ID, correlationId: "corr-1" },
        network: { kind: "http", url: `${lab.origin}/admin` },
        limits: { maxRequestBudget: 50, maxDurationMs: 300_000 },
        requestsConsumed: 0,
        nowMs: Date.now(),
        cancelled: false,
        emergencyStop: false,
        httpConcurrencyLimiter: undefined,
      },
    });
    expect(() => assertPathAllowed(target!, "/admin")).toThrow(/outside authorized scope/);
  });

  it("TEST 8 — production_safe authorization is blocked by production gate", async () => {
    const production = buildApprovedAuthorization(lab.origin);
    production.environment_type = "production_safe";
    const admin = createFakeAdmin({ attack_authorizations: [production] });
    const resolved = await resolveDynamicTargetForAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
    });
    expect(resolved.source).toBe("none");
    expect(resolved.runtimeMode).toBe("mock");
  });

  it("TEST 4b — MCP authorize flow: initiate → verify → approve", async () => {
    const admin = createFakeAdmin({
      projects: [
        {
          id: E2E_PROJECT_ID,
          name: "Auth Flow Project",
          organization_id: E2E_ORG_ID,
          github_repo: "sequrai/auth-flow",
        },
      ],
      attack_authorizations: [],
      dynamic_target_verifications: [],
    });

    const ctx = mcpCtx(admin);
    const initiate = await authorizeDynamicTarget(
      ctx,
      {
        projectId: E2E_PROJECT_ID,
        action: "initiate",
        targetOrigin: lab.origin,
        verificationMethod: "http",
      },
      t
    );
    expect(initiate.action).toBe("initiate");

    const verify = await authorizeDynamicTarget(
      ctx,
      { projectId: E2E_PROJECT_ID, action: "verify", targetOrigin: lab.origin },
      t
    );
    expect(verify.verified).toBe(true);

    const approve = await authorizeDynamicTarget(
      ctx,
      {
        projectId: E2E_PROJECT_ID,
        action: "approve",
        targetOrigin: lab.origin,
        environmentType: "staging",
      },
      t
    );
    expect(approve.application?.verified).toBe(true);
    expect(approve.application?.url).toBe(lab.origin);
  });

  it("TEST 1/11 — authorized project runs full_product_audit with authorized_staging", async () => {
    const origin = lab.origin;
    const { admin } = createFullProductAuditE2EAdmin({
      attackAuthorizations: [buildApprovedAuthorization(origin)],
    });

    const result = await runFullProductAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      projectName: "Authorized Project",
      repositoryFullName: "sequrai/authorized",
      githubRepo: "sequrai/authorized",
      githubRepositoryId: 99,
      commitSha: E2E_COMMIT_SHA,
      waitForReviewMs: 500,
      waitForSecurityTestsMs: 2_000,
      reviewDeps: buildReviewDeps(),
    });

    expect(result.engines.securityTesting.dynamicTargetSource).toBe("authorization");
    expect(result.engines.securityTesting.runtimeMode).toBe("authorized_staging");
    expect(result.engines.securityTesting.adaptersExecuted.length).toBeGreaterThan(0);
  }, 30_000);

  it("TEST 12 — MCP full_product_audit without authorization keeps static analysis", async () => {
    const { admin } = createFullProductAuditE2EAdmin();
    const result = await runFullProductAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      projectName: "Static Only",
      repositoryFullName: "sequrai/static-only",
      githubRepo: "sequrai/static-only",
      githubRepositoryId: 100,
      commitSha: E2E_COMMIT_SHA,
      waitForReviewMs: 500,
      waitForSecurityTestsMs: 500,
      reviewDeps: buildReviewDeps(),
    });
    expect(result.engines.codeReview.findingsCount).toBeGreaterThan(0);
    expect(result.engines.securityTesting.runtimeMode).toBe("mock");
  });
});

describe("approve without verification is blocked", () => {
  it("cannot approve before ownership verification", async () => {
    const admin = createFakeAdmin({
      dynamic_target_verifications: [],
      attack_authorizations: [],
    });
    const result = await approveDynamicTargetAuthorization(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      targetOrigin: lab.origin,
      environmentType: "staging",
      createdBy: "user-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ownership_not_verified");
    }
  });
});

describe("service-level verification records", () => {
  it("initiate creates pending verification", async () => {
    const admin = createFakeAdmin({
      dynamic_target_verifications: [],
    });
    const { verification } = await initiateDynamicTargetVerification(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      targetOrigin: "https://staging.example.com",
      verificationMethod: "http",
      createdBy: "user-1",
    });
    expect(verification.status).toBe("pending");
  });

  it("verify marks verification as verified with mocked HTTP proof", async () => {
    const admin = createFakeAdmin({ dynamic_target_verifications: [] });
    await initiateDynamicTargetVerification(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      targetOrigin: lab.origin,
      verificationMethod: "http",
      createdBy: "user-1",
    });
    const verified = await verifyDynamicTargetOwnership(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      targetOrigin: lab.origin,
    });
    expect(verified.ok).toBe(true);
  });
});
