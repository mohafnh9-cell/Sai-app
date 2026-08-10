import { describe, expect, it } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import {
  pathsMissingFromApprovedScope,
  reapproveExpandedDynamicTargetScope,
} from "../dynamic-scope-expansion";
import { assertPathAllowed, isPathWithinApprovedScope } from "@/server/attack-simulation/dynamic/authorized-target";
import { mergeMinimalAllowedPaths, normalizeAllowedPaths } from "../target-verification";
import type { AttackAuthorizationRecord } from "../types";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const TARGET = "https://sequrai-app.vercel.app";

function buildAuthorization(overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  return {
    id: "auth-1",
    organization_id: ORG_ID,
    project_id: PROJECT_ID,
    target_origin: TARGET,
    environment_type: "staging",
    status: "approved",
    authorization_method: "domain_verified_staging",
    approved_scope: { allowedPaths: ["/api", "/login", "/health", "/auth"] },
    created_by: "user-1",
    approved_at: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 3_600_000).toISOString(),
    test_credentials_ref: null,
    path_exclusions: ["/api/admin/delete", "/api/billing", "/api/payments"],
    redirect_allowlist: [],
    max_request_budget: 50,
    max_duration_seconds: 300,
    commit_sha: null,
    ...overrides,
  };
}

describe("dynamic scope expansion", () => {
  it("existing scope covers route — no scope change required", async () => {
    const admin = createFakeAdmin({
      attack_authorizations: [buildAuthorization()],
    });
    const result = await reapproveExpandedDynamicTargetScope(admin as never, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      targetOrigin: TARGET,
      requiredPaths: ["/login"],
      createdBy: "user-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scopeChanged).toBe(false);
      expect(result.addedPaths).toEqual([]);
    }
  });

  it("adds /forgot-password through explicit reapproval", async () => {
    const authorizationRow = buildAuthorization();
    const admin = createFakeAdmin({
      attack_authorizations: [authorizationRow],
    });
    const result = await reapproveExpandedDynamicTargetScope(admin as never, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      targetOrigin: TARGET,
      requiredPaths: ["/forgot-password"],
      createdBy: "user-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scopeChanged).toBe(true);
    expect(result.mergedScope).toEqual([
      "/api",
      "/login",
      "/health",
      "/auth",
      "/forgot-password",
    ]);
    expect(result.authorization.authorizationMethod).toContain("scope_expansion_reapproval");
    expect(result.authorization.pathExclusions).toEqual([
      "/api/admin/delete",
      "/api/billing",
      "/api/payments",
    ]);
    expect(result.authorization.maxRequestBudget).toBe(50);
    expect(result.authorization.expiresAt).toBe(authorizationRow.expires_at);
  });

  it("keeps scope minimal and never adds / or /* automatically", () => {
    const merged = mergeMinimalAllowedPaths(["/api", "/login"], ["/forgot-password"]);
    expect(merged).toEqual(["/api", "/login", "/forgot-password"]);
    expect(merged).not.toContain("/");
    expect(merged).not.toContain("/*");
    expect(normalizeAllowedPaths(undefined)).not.toEqual(["/"]);
  });

  it("does not add unrelated routes", () => {
    const missing = pathsMissingFromApprovedScope(
      ["/forgot-password"],
      ["/api", "/login", "/health", "/auth"],
      []
    );
    expect(missing).toEqual(["/forgot-password"]);
    expect(
      pathsMissingFromApprovedScope(["/admin-panel"], ["/api", "/login"], [])
    ).toEqual(["/admin-panel"]);
  });

  it("unknown route does not expand scope when not required", async () => {
    const admin = createFakeAdmin({
      attack_authorizations: [buildAuthorization()],
    });
    const result = await reapproveExpandedDynamicTargetScope(admin as never, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      targetOrigin: TARGET,
      requiredPaths: ["/*"],
      createdBy: "user-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_REQUIRED_PATH");
  });

  it("preserves path exclusions during expansion", async () => {
    const admin = createFakeAdmin({
      attack_authorizations: [buildAuthorization()],
    });
    const result = await reapproveExpandedDynamicTargetScope(admin as never, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      targetOrigin: TARGET,
      requiredPaths: ["/api/billing"],
      createdBy: "user-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PATH_EXCLUDED");
  });

  it("cross-tenant route cannot expand scope", async () => {
    const admin = createFakeAdmin({
      attack_authorizations: [buildAuthorization()],
    });
    const result = await reapproveExpandedDynamicTargetScope(admin as never, {
      organizationId: "99999999-9999-4999-8999-999999999999",
      projectId: PROJECT_ID,
      targetOrigin: TARGET,
      requiredPaths: ["/forgot-password"],
      createdBy: "user-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AUTHORIZATION_NOT_ACTIVE");
  });

  it("cross-project route cannot expand scope", async () => {
    const admin = createFakeAdmin({
      attack_authorizations: [buildAuthorization()],
    });
    const result = await reapproveExpandedDynamicTargetScope(admin as never, {
      organizationId: ORG_ID,
      projectId: OTHER_PROJECT_ID,
      targetOrigin: TARGET,
      requiredPaths: ["/forgot-password"],
      createdBy: "user-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AUTHORIZATION_NOT_ACTIVE");
  });

  it("expired authorization cannot expand scope", async () => {
    const admin = createFakeAdmin({
      attack_authorizations: [
        buildAuthorization({
          expires_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      ],
    });
    const result = await reapproveExpandedDynamicTargetScope(admin as never, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      targetOrigin: TARGET,
      requiredPaths: ["/forgot-password"],
      createdBy: "user-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AUTHORIZATION_NOT_ACTIVE");
  });

  it("production authorization remains blocked", async () => {
    const admin = createFakeAdmin({
      attack_authorizations: [
        buildAuthorization({
          environment_type: "production_safe",
        }),
      ],
    });
    const result = await reapproveExpandedDynamicTargetScope(admin as never, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      targetOrigin: TARGET,
      requiredPaths: ["/forgot-password"],
      createdBy: "user-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PRODUCTION_TARGET_NOT_SUPPORTED");
  });

  it("Gate 3 still rejects paths outside approved scope", () => {
    const target = {
      baseUrl: TARGET,
      origin: TARGET,
      environment: "staging" as const,
      authorized: true,
      authorization: null,
      allowedPaths: ["/api", "/login", "/health", "/auth"],
      pathExclusions: ["/api/admin/delete", "/api/billing", "/api/payments"],
      maxRequestBudget: 50,
      maxDurationMs: 300_000,
      attackMode: "authorized_staging" as const,
      testIdentities: {},
    };
    expect(isPathWithinApprovedScope("/forgot-password", target.allowedPaths, target.pathExclusions)).toBe(
      false
    );
    expect(() => assertPathAllowed(target, "/forgot-password")).toThrow(/outside authorized scope/);
    target.allowedPaths = mergeMinimalAllowedPaths(target.allowedPaths, ["/forgot-password"]);
    expect(() => assertPathAllowed(target, "/forgot-password")).not.toThrow();
    expect(() => assertPathAllowed(target, "/secret-admin")).toThrow(/outside authorized scope/);
  });

  it("records scope expansion evidence on successor authorization", async () => {
    const admin = createFakeAdmin({
      attack_authorizations: [buildAuthorization({ id: "auth-old" })],
    });
    const result = await reapproveExpandedDynamicTargetScope(admin as never, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      targetOrigin: TARGET,
      requiredPaths: ["/forgot-password"],
      createdBy: "user-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const evidence = result.authorization.approvedScope.scopeExpansionEvidence as Record<string, unknown>;
    expect(evidence.supersededAuthorizationId).toBe("auth-old");
    expect(evidence.addedPaths).toEqual(["/forgot-password"]);
  });
});
