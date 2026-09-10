import { afterEach, describe, expect, it, vi } from "vitest";
import { assertOrganizationCanRunScan } from "../assert-scan-access";
import { ScanRequestError } from "@/server/security-scanner/request-context";

/**
 * Phase 12.1: proves the REAL assertOrganizationCanRunScan (not mocked) is
 * genuinely a no-op with billing disabled -- the exact "current disabled
 * behavior must remain unchanged" requirement -- and genuinely enforces
 * once enabled. This is the function every scan entry point (GitHub,
 * Upload, Local) now calls before doing any scan work.
 */
function subscriptionAdminStub(
  subscriptionRow: { status: string; free_scans_used?: number } | null
) {
  // Mutable so a `.rpc()` call and a subsequent `.from("subscriptions")` read
  // see the same, evolving free_scans_used state -- matching how the real
  // Postgres row is shared between reads and the atomic-increment function.
  let row = subscriptionRow ? { free_scans_used: 0, ...subscriptionRow } : null;
  return {
    from: (table: string) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { email: "user@example.com" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (fn: string, args: { p_organization_id: string; p_limit: number }) => {
      if (fn !== "consume_free_scan_credit") throw new Error(`unexpected rpc ${fn}`);
      // Self-heals a missing row, exactly like the real Postgres function
      // (organizations that never opened Stripe checkout have none yet).
      if (!row) row = { status: "canceled", free_scans_used: 0 };
      if (row.free_scans_used >= args.p_limit) return { data: false, error: null };
      row.free_scans_used += 1;
      return { data: true, error: null };
    },
  } as never;
}

describe("assertOrganizationCanRunScan", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("billing disabled: never queries subscriptions and never throws (current behavior, unchanged)", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_SEQURAI_BILLING_ENABLED", "");
    const admin = {
      from: () => {
        throw new Error("must not query anything when billing is disabled");
      },
    } as never;

    await expect(
      assertOrganizationCanRunScan(admin, "org-1", { id: "user-1", email: "user@example.com" })
    ).resolves.toBeUndefined();
  });

  it("billing enabled + no active subscription: grants exactly FREE_SCAN_LIMIT scans, then rejects with SCAN_LIMIT_REACHED", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
    const admin = subscriptionAdminStub(null);
    const user = { id: "user-1", email: "user@example.com" };

    // First FREE_SCAN_LIMIT (2) calls are granted -- this is the new Free
    // plan, not the old unconditional block.
    await expect(assertOrganizationCanRunScan(admin, "org-1", user)).resolves.toBeUndefined();
    await expect(assertOrganizationCanRunScan(admin, "org-1", user)).resolves.toBeUndefined();

    // The 3rd is rejected with the documented, structured error code.
    try {
      await assertOrganizationCanRunScan(admin, "org-1", user);
      throw new Error("expected assertOrganizationCanRunScan to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ScanRequestError);
      expect((error as InstanceType<typeof ScanRequestError>).status).toBe(402);
      expect((error as InstanceType<typeof ScanRequestError>).code).toBe("SCAN_LIMIT_REACHED");
    }
  });

  it("billing enabled + free plan already at the limit: rejects immediately", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
    const admin = subscriptionAdminStub({ status: "canceled", free_scans_used: 2 });

    await expect(
      assertOrganizationCanRunScan(admin, "org-1", { id: "user-1", email: "user@example.com" })
    ).rejects.toMatchObject({ status: 402, code: "SCAN_LIMIT_REACHED" });
  });

  it("admin bypass email: unaffected by the free-scan limit even with zero credits left", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "admin@example.com");
    const admin = subscriptionAdminStub({ status: "canceled", free_scans_used: 2 });

    await expect(
      assertOrganizationCanRunScan(admin, "org-1", { id: "user-1", email: "admin@example.com" })
    ).resolves.toBeUndefined();
  });

  it("billing enabled + active subscription: succeeds", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
    const admin = subscriptionAdminStub({ status: "active" });

    await expect(
      assertOrganizationCanRunScan(admin, "org-1", { id: "user-1", email: "user@example.com" })
    ).resolves.toBeUndefined();
  });
});
