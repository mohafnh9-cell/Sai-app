import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

/**
 * Phase 34 P0: the dynamic-testing stage of full_product_audit previously ran
 * with no billing check of its own -- every other scan/compute entry point
 * already goes through assertOrganizationCanRunScan() (see
 * server/billing/__tests__/scan-entry-points-gate.test.ts, Phase 31.2). This
 * proves the gate added in run-security-tests.ts actually runs, and runs
 * BEFORE any campaign/network work, using the real (unmocked)
 * assertOrganizationCanRunScan + consume_free_scan_credit RPC fake, exactly
 * like the existing Phase 31.2 suite.
 *
 * The target-resolution / hypothesis-building machinery upstream of the gate
 * (resolveDynamicTargetForAudit, buildHypothesesFromStaticFindings) is
 * mocked here, not re-exercised -- that machinery already has its own
 * dedicated e2e coverage (dynamic-target-authorization-e2e.test.ts,
 * full-product-audit-dynamic-e2e.test.ts). This test isolates one thing: did
 * the new gate run before startAttackCampaign, using its real billing logic.
 */

vi.mock("../resolve-dynamic-target", () => ({
  resolveDynamicTargetForAudit: vi.fn(async () => ({
    source: "authorization",
    targetUrl: "https://staging.example.com",
    runtimeMode: "authorized_staging",
    authorization: { id: "auth-1", approvedScope: { allowedPaths: ["/"] }, pathExclusions: [], targetOrigin: "https://staging.example.com" },
  })),
}));

vi.mock("../build-hypotheses-from-findings", () => ({
  buildHypothesesFromStaticFindings: vi.fn(() => ({
    hypotheses: [{ id: "h1", adapterId: "idor-cross-tenant", targetPath: "/api/projects/1" }],
    notSafelyTestableCount: 0,
  })),
}));

vi.mock("../required-dynamic-paths", () => ({
  collectRequiredDynamicPaths: vi.fn(() => []),
}));

vi.mock("@/server/attack-simulation/start-attack-campaign", () => ({
  startAttackCampaign: vi.fn(async () => ({ campaignId: "campaign-1", executionIds: ["exec-1"] })),
  StartAttackCampaignError: class StartAttackCampaignError extends Error {
    code = "campaign_start_failed";
  },
}));

vi.mock("../poll", () => ({
  waitForScanCampaign: vi.fn(async () => ({ campaignId: null, timedOut: false })),
  pollUntilAttackCampaignTerminal: vi.fn(async () => ({ timedOut: false })),
}));

vi.mock("@/lib/i18n/server", () => ({
  getTranslator: async () => ({ t: (key: string) => key }),
}));

const ORG_A = "org-a";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";

function exhaustedFreeTierTables(): FakeTables {
  return {
    subscriptions: [{ organization_id: ORG_A, plan: "FREE", status: "canceled", free_scans_used: 2 }],
    profiles: [{ id: "user-1", email: "user@example.com" }],
  };
}

function freshOrgTables(): FakeTables {
  return {
    subscriptions: [],
    profiles: [{ id: "user-1", email: "user@example.com" }],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Phase 34 -- ensureSecurityTestsForAudit respects the billing gate", () => {
  it("billing enabled + free scans already exhausted: skips with scan_limit_reached and never calls startAttackCampaign", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    const { ensureSecurityTestsForAudit } = await import("../run-security-tests");
    const tables = exhaustedFreeTierTables();
    const admin = createFakeAdmin(tables);

    const result = await ensureSecurityTestsForAudit(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: "scan-1",
      scanJobId: null,
      commitSha: "a".repeat(40),
      dynamicVerificationDecision: "authorize",
      staticFindings: [
        { id: "static-1", ruleId: "SEC-999", title: "Weak authorization", severity: "high", category: "authorization" },
      ],
      userId: "user-1",
    });

    expect(result.skippedReason).toBe("scan_limit_reached");
    expect(result.campaignId).toBeNull();
    expect(result.executionIds).toHaveLength(0);
  });

  it("billing enabled + a brand-new organization: the gate grants a free credit and the campaign path is reached", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    const { ensureSecurityTestsForAudit } = await import("../run-security-tests");
    const tables = freshOrgTables();
    const admin = createFakeAdmin(tables);

    const result = await ensureSecurityTestsForAudit(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: "scan-2",
      scanJobId: null,
      commitSha: "a".repeat(40),
      dynamicVerificationDecision: "authorize",
      staticFindings: [
        { id: "static-1", ruleId: "SEC-999", title: "Weak authorization", severity: "high", category: "authorization" },
      ],
      userId: "user-1",
    });

    expect(result.skippedReason).not.toBe("scan_limit_reached");
    expect(tables.subscriptions?.[0]).toMatchObject({ organization_id: ORG_A, free_scans_used: 1 });
  });

  it("billing disabled: unaffected -- reaches the mocked campaign path even with an exhausted free tier", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_SEQURAI_BILLING_ENABLED", "");
    const { ensureSecurityTestsForAudit } = await import("../run-security-tests");
    const tables = exhaustedFreeTierTables();
    const admin = createFakeAdmin(tables);

    const result = await ensureSecurityTestsForAudit(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: "scan-3",
      scanJobId: null,
      commitSha: "a".repeat(40),
      dynamicVerificationDecision: "authorize",
      staticFindings: [
        { id: "static-1", ruleId: "SEC-999", title: "Weak authorization", severity: "high", category: "authorization" },
      ],
      userId: "user-1",
    });

    expect(result.skippedReason).not.toBe("scan_limit_reached");
  });
});
