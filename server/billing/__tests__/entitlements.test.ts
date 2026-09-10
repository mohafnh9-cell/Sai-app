import { describe, expect, it } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { FREE_SCAN_LIMIT, consumeFreeScanCredit, getOrganizationEntitlements } from "../entitlements";

const ORG_A = "org-a";
const ORG_B = "org-b";

function emptyTables(): FakeTables {
  return { subscriptions: [] };
}

describe("consumeFreeScanCredit", () => {
  it("grants exactly FREE_SCAN_LIMIT credits for a brand-new organization with no subscriptions row", async () => {
    const tables = emptyTables();
    const admin = createFakeAdmin(tables);

    for (let i = 0; i < FREE_SCAN_LIMIT; i++) {
      await expect(consumeFreeScanCredit(admin as never, ORG_A)).resolves.toBe(true);
    }
    await expect(consumeFreeScanCredit(admin as never, ORG_A)).resolves.toBe(false);

    expect(tables.subscriptions).toHaveLength(1);
    expect(tables.subscriptions[0]).toMatchObject({
      organization_id: ORG_A,
      free_scans_used: FREE_SCAN_LIMIT,
    });
  });

  it("self-heals a missing subscriptions row using the FREE/canceled convention, matching server/billing/customer.ts", async () => {
    const tables = emptyTables();
    const admin = createFakeAdmin(tables);

    await consumeFreeScanCredit(admin as never, ORG_A);

    expect(tables.subscriptions[0]).toMatchObject({ plan: "FREE", status: "canceled" });
  });

  it("never lets a second, already-exhausted call succeed (this is the sequential decision-logic proof; real concurrent-request safety comes from Postgres row locking in the live consume_free_scan_credit function and cannot be proven against this synchronous fake)", async () => {
    const tables: FakeTables = {
      subscriptions: [
        { organization_id: ORG_A, plan: "FREE", status: "canceled", free_scans_used: FREE_SCAN_LIMIT - 1 },
      ],
    };
    const admin = createFakeAdmin(tables);

    const [first, second] = await Promise.all([
      consumeFreeScanCredit(admin as never, ORG_A),
      consumeFreeScanCredit(admin as never, ORG_A),
    ]);

    // Exactly one of the two calls consumed the last remaining credit.
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(tables.subscriptions[0]!.free_scans_used).toBe(FREE_SCAN_LIMIT);
  });

  it("keeps two organizations' credit counters fully independent", async () => {
    const tables = emptyTables();
    const admin = createFakeAdmin(tables);

    for (let i = 0; i < FREE_SCAN_LIMIT; i++) {
      await consumeFreeScanCredit(admin as never, ORG_A);
    }
    // Org A is exhausted; Org B must still get its own full allowance.
    await expect(consumeFreeScanCredit(admin as never, ORG_A)).resolves.toBe(false);
    await expect(consumeFreeScanCredit(admin as never, ORG_B)).resolves.toBe(true);

    const orgBRow = tables.subscriptions.find((r) => r.organization_id === ORG_B);
    expect(orgBRow).toMatchObject({ free_scans_used: 1 });
  });
});

describe("getOrganizationEntitlements", () => {
  it("reports the Free plan with scansRemaining and canScan derived from usage", async () => {
    const tables: FakeTables = {
      subscriptions: [
        { organization_id: ORG_A, plan: "FREE", status: "canceled", free_scans_used: 1 },
      ],
    };
    const admin = createFakeAdmin(tables);

    const entitlements = await getOrganizationEntitlements(admin as never, ORG_A);

    expect(entitlements).toMatchObject({
      plan: "FREE",
      scanLimit: FREE_SCAN_LIMIT,
      scansUsed: 1,
      scansRemaining: FREE_SCAN_LIMIT - 1,
      canScan: true,
      upgradeRequired: false,
    });
  });

  it("reports canScan: false and upgradeRequired: true once the free limit is reached", async () => {
    const tables: FakeTables = {
      subscriptions: [
        { organization_id: ORG_A, plan: "FREE", status: "canceled", free_scans_used: FREE_SCAN_LIMIT },
      ],
    };
    const admin = createFakeAdmin(tables);

    const entitlements = await getOrganizationEntitlements(admin as never, ORG_A);

    expect(entitlements).toMatchObject({
      scansRemaining: 0,
      canScan: false,
      upgradeRequired: true,
    });
  });

  it("reports unlimited scanning for an active paid subscription, regardless of free_scans_used", async () => {
    const tables: FakeTables = {
      subscriptions: [
        { organization_id: ORG_A, plan: "BUILDER", status: "active", free_scans_used: 9 },
      ],
    };
    const admin = createFakeAdmin(tables);

    const entitlements = await getOrganizationEntitlements(admin as never, ORG_A);

    expect(entitlements).toMatchObject({
      plan: "BUILDER",
      scanLimit: null,
      scansRemaining: null,
      canScan: true,
      upgradeRequired: false,
    });
  });

  it("treats a brand-new organization (no subscriptions row) as Free with a full allowance", async () => {
    const admin = createFakeAdmin(emptyTables());

    const entitlements = await getOrganizationEntitlements(admin as never, ORG_A);

    expect(entitlements).toMatchObject({
      plan: "FREE",
      scanLimit: FREE_SCAN_LIMIT,
      scansUsed: 0,
      scansRemaining: FREE_SCAN_LIMIT,
      canScan: true,
    });
  });

  it("never includes Stripe customer/subscription IDs in the entitlements payload", async () => {
    const tables: FakeTables = {
      subscriptions: [
        {
          organization_id: ORG_A,
          plan: "FREE",
          status: "canceled",
          free_scans_used: 0,
          stripe_customer_id: "cus_secret123",
          stripe_subscription_id: "sub_secret456",
        },
      ],
    };
    const admin = createFakeAdmin(tables);

    const entitlements = await getOrganizationEntitlements(admin as never, ORG_A);

    expect(JSON.stringify(entitlements)).not.toContain("cus_secret123");
    expect(JSON.stringify(entitlements)).not.toContain("sub_secret456");
  });
});
