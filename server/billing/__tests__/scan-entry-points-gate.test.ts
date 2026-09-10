import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

/**
 * Phase 31.2: three scan-creation entry points (MCP review_now, webhook
 * automatic review on push, GitHub automation scheduled/incremental scans)
 * were found to create `scans` rows with NO billing check at all -- every
 * other entry point (GitHub manual, upload, local, CI) already calls
 * assertOrganizationCanRunScan() first. These tests prove the real,
 * unmocked gate now runs for all three, using the same billing-enabled +
 * no-active-subscription env-stubbing pattern as
 * server/billing/__tests__/assert-scan-access.test.ts.
 */

const ORG_A = "org-a";

function billingTables(): FakeTables {
  return {
    subscriptions: [],
    profiles: [{ id: "user-1", email: "user@example.com" }],
    scans: [],
    repository_scan_state: [],
    production_verdicts: [],
  };
}

/**
 * An organization on the Free plan that has already used both of its free
 * scan credits (migration 060 / server/billing/entitlements.ts). Distinct
 * from `billingTables()` (no subscriptions row at all), which now gets 2
 * free scans before being rejected -- see assert-scan-access.test.ts.
 */
function exhaustedFreeTierTables(): FakeTables {
  return {
    subscriptions: [
      { organization_id: ORG_A, plan: "FREE", status: "canceled", free_scans_used: 2 },
    ],
    profiles: [{ id: "user-1", email: "user@example.com" }],
    scans: [],
    repository_scan_state: [],
    production_verdicts: [],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Phase 31.2 -- review_now (MCP) respects the billing gate", () => {
  it("billing enabled + free scans already exhausted: rejects with scan_limit_reached, creates no scan row", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    const { triggerProductionReview, ReviewNowError } = await import("../../review-now/trigger-review");
    const tables = exhaustedFreeTierTables();
    const admin = createFakeAdmin(tables);

    await expect(
      triggerProductionReview(
        admin as never,
        {
          organizationId: ORG_A,
          projectId: "11111111-1111-4111-8111-111111111111",
          githubRepo: "acme/alpha",
          githubRepositoryId: 42,
        },
        {
          resolveToken: async () => ({ token: "gh-token", userId: "user-1" }),
          resolveCommit: async () => ({ sha: "abc123", branch: "main" }),
          runScan: vi.fn(),
          scheduleBackground: () => {},
        }
      )
    ).rejects.toMatchObject({ code: "scan_limit_reached" } as InstanceType<typeof ReviewNowError>);

    expect(tables.scans).toHaveLength(0);
  });

  it("billing enabled + a brand-new organization (no subscriptions row yet): the first scan is granted as a free credit", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    const { triggerProductionReview } = await import("../../review-now/trigger-review");
    const tables = billingTables();
    const admin = createFakeAdmin(tables);

    const result = await triggerProductionReview(
      admin as never,
      {
        organizationId: ORG_A,
        projectId: "11111111-1111-4111-8111-111111111111",
        githubRepo: "acme/alpha",
        githubRepositoryId: 42,
      },
      {
        resolveToken: async () => ({ token: "gh-token", userId: "user-1" }),
        resolveCommit: async () => ({ sha: "abc123", branch: "main" }),
        runScan: vi.fn(),
        scheduleBackground: () => {},
      }
    );

    expect(result.outcome).toBe("queued");
    expect(tables.scans).toHaveLength(1);
    expect(tables.subscriptions[0]).toMatchObject({ organization_id: ORG_A, free_scans_used: 1 });
  });

  it("billing disabled: unaffected (existing no-op behavior preserved)", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_SEQURAI_BILLING_ENABLED", "");
    const { triggerProductionReview } = await import("../../review-now/trigger-review");
    const tables = billingTables();
    const admin = createFakeAdmin(tables);

    const result = await triggerProductionReview(
      admin as never,
      {
        organizationId: ORG_A,
        projectId: "11111111-1111-4111-8111-111111111111",
        githubRepo: "acme/alpha",
        githubRepositoryId: 42,
      },
      {
        resolveToken: async () => ({ token: "gh-token", userId: "user-1" }),
        resolveCommit: async () => ({ sha: "abc123", branch: "main" }),
        runScan: vi.fn(),
        scheduleBackground: () => {},
      }
    );
    expect(result.outcome).toBe("queued");
    expect(tables.scans).toHaveLength(1);
  });
});

describe("Phase 31.2 -- automatic review on push respects the billing gate", () => {
  it("billing enabled + free scans already exhausted: returns automatic_review_skipped, creates no scan row", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    const { runAutomaticProductionReview } = await import("../../automatic-review/run-on-push");
    const tables = exhaustedFreeTierTables();
    const admin = createFakeAdmin(tables);

    const result = await runAutomaticProductionReview(admin as never, {
      project: {
        id: "proj-1",
        organization_id: ORG_A,
        github_repo: "acme/alpha",
        github_repository_id: 42,
      },
      detection: {
        branch: "main",
        commitSha: "a".repeat(40),
        commitMessage: "test commit",
        pushedAt: new Date().toISOString(),
      },
      token: "gh-token",
      userId: "user-1",
    });

    expect(result).toMatchObject({ ok: true, action: "automatic_review_skipped", reason: "scan_limit_reached" });
    expect(tables.scans).toHaveLength(0);
  });
});

describe("Phase 31.2 -- GitHub automation (scheduled/incremental) scan respects the billing gate", () => {
  it("billing enabled + free scans already exhausted: returns null, creates no scan row", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    const { createAutomationScan } = await import("../../github-automation/automation-scan");
    const tables = exhaustedFreeTierTables();
    const admin = createFakeAdmin(tables);

    const scanId = await createAutomationScan(admin as never, {
      organizationId: ORG_A,
      projectId: "proj-1",
      userId: "user-1",
      scanType: "incremental",
      commitSha: "abc123",
    });

    expect(scanId).toBeNull();
    expect(tables.scans).toHaveLength(0);
  });

  it("billing disabled: creates the scan (existing no-op behavior preserved)", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_SEQURAI_BILLING_ENABLED", "");
    const { createAutomationScan } = await import("../../github-automation/automation-scan");
    const tables = billingTables();
    const admin = createFakeAdmin(tables);

    const scanId = await createAutomationScan(admin as never, {
      organizationId: ORG_A,
      projectId: "proj-1",
      userId: "user-1",
      scanType: "incremental",
      commitSha: "abc123",
    });

    expect(scanId).not.toBeNull();
    expect(tables.scans).toHaveLength(1);
  });
});
