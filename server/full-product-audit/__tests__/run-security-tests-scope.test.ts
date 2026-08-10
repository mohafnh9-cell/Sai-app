import { describe, expect, it, vi } from "vitest";
import { ensureSecurityTestsForAudit } from "../run-security-tests";
import {
  createFullProductAuditE2EAdmin,
  E2E_COMMIT_SHA,
  E2E_ORG_ID,
  E2E_PROJECT_ID,
} from "./e2e-harness";

vi.mock("@/lib/i18n/server", () => ({
  getTranslator: async () => {
    const t = (key: string) => key;
    return { t };
  },
}));

vi.mock("@/server/feature-flags", () => ({
  isFeatureEnabled: () => true,
}));

function buildApprovedAuthorization(origin: string) {
  const now = Date.now();
  return {
    id: "77777777-7777-4777-8777-777777777777",
    organization_id: E2E_ORG_ID,
    project_id: E2E_PROJECT_ID,
    target_origin: origin,
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
  };
}

function verificationRow(origin: string) {
  return {
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
  };
}

const forgotPasswordFinding = {
  id: "finding-1",
  ruleId: "web-coverage-evaluated",
  title: "Web coverage evaluated",
  description: null,
  severity: "info",
  category: "web",
  filePath: "app/(auth)/forgot-password/page.tsx",
  recommendation: null,
  confidence: "high",
  evidence: null,
};

describe("ensureSecurityTestsForAudit scope gate", () => {
  it("pauses for explicit scope approval when /forgot-password is required", async () => {
    const origin = "https://sequrai-app.vercel.app";
    const { admin } = createFullProductAuditE2EAdmin({
      attackAuthorizations: [buildApprovedAuthorization(origin)],
      dynamicTargetVerifications: [verificationRow(origin)],
    });

    const result = await ensureSecurityTestsForAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      scanId: "scan-scope-gate",
      scanJobId: null,
      commitSha: E2E_COMMIT_SHA,
      waitForScanBootstrapMs: 100,
      staticFindings: [forgotPasswordFinding],
    });

    expect(result.skippedReason).toBe("awaiting_scope_approval");
    expect(result.dynamicVerification.awaitingScopeApproval).toBe(true);
    expect(result.campaignId).toBeNull();
  });

  it("expands scope after explicit approval", async () => {
    const origin = "https://sequrai-app.vercel.app";
    const { admin, tables } = createFullProductAuditE2EAdmin({
      attackAuthorizations: [buildApprovedAuthorization(origin)],
      dynamicTargetVerifications: [verificationRow(origin)],
    });

    await ensureSecurityTestsForAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      scanId: "scan-scope-approved",
      scanJobId: null,
      commitSha: E2E_COMMIT_SHA,
      waitForScanBootstrapMs: 100,
      dynamicScopeExpansionApproved: true,
      staticFindings: [forgotPasswordFinding],
    });

    const approved = (tables.attack_authorizations ?? []).filter(
      (row) => row.status === "approved"
    );
    expect(approved).toHaveLength(1);
    expect(approved[0]?.approved_scope).toMatchObject({
      allowedPaths: expect.arrayContaining(["/forgot-password", "/api", "/login"]),
    });
  });
});
