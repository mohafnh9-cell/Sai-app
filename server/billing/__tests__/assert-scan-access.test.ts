import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertOrganizationCanRunScan } from "../assert-scan-access";
import { ScanRequestError } from "@/server/security-scanner/request-context";

type StubAdmin = SupabaseClient & { rpcCallCount: () => number };

/**
 * Phase 12.1: proves the REAL assertOrganizationCanRunScan (not mocked) is
 * genuinely a no-op with billing disabled -- the exact "current disabled
 * behavior must remain unchanged" requirement -- and genuinely enforces
 * once enabled. This is the function every scan entry point (GitHub,
 * Upload, Local) now calls before doing any scan work.
 */
function subscriptionAdminStub(
  subscriptionRow: { status: string; free_scans_used?: number; stripe_subscription_id?: string | null } | null,
  profileRow: { email?: string; is_platform_admin?: boolean } = { email: "user@example.com" }
) {
  // Mutable so a `.rpc()` call and a subsequent `.from("subscriptions")` read
  // see the same, evolving free_scans_used state -- matching how the real
  // Postgres row is shared between reads and the atomic-increment function.
  let row = subscriptionRow ? { free_scans_used: 0, ...subscriptionRow } : null;
  let rpcCallCount = 0;
  const stub = {
    rpcCallCount: () => rpcCallCount,
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
              maybeSingle: async () => ({ data: profileRow, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (fn: string, args: { p_organization_id: string; p_limit: number }) => {
      rpcCallCount += 1;
      if (fn !== "consume_free_scan_credit") throw new Error(`unexpected rpc ${fn}`);
      // Self-heals a missing row, exactly like the real Postgres function
      // (organizations that never opened Stripe checkout have none yet).
      if (!row) row = { status: "canceled", free_scans_used: 0 };
      if (row.free_scans_used >= args.p_limit) return { data: false, error: null };
      row.free_scans_used += 1;
      return { data: true, error: null };
    },
  };
  return stub as unknown as StubAdmin;
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

  it("Phase 46: an org that never subscribed (no stripe_subscription_id) still gets SCAN_LIMIT_REACHED, not SUBSCRIPTION_REQUIRED, once free credits are exhausted", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
    const admin = subscriptionAdminStub({ status: "canceled", free_scans_used: 2 });

    await expect(
      assertOrganizationCanRunScan(admin, "org-1", { id: "user-1", email: "user@example.com" })
    ).rejects.toMatchObject({ status: 402, code: "SCAN_LIMIT_REACHED" });
  });

  it("Phase 46: an org with a lapsed Stripe subscription (stripe_subscription_id present, status no longer active) gets SUBSCRIPTION_REQUIRED, not SCAN_LIMIT_REACHED, even with 0 free credits remaining -- the free-quota message would be misleading for someone who already paid before", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
    const admin = subscriptionAdminStub({
      status: "canceled",
      free_scans_used: 2,
      stripe_subscription_id: "sub_lapsed_123",
    });

    await expect(
      assertOrganizationCanRunScan(admin, "org-1", { id: "user-1", email: "user@example.com" })
    ).rejects.toMatchObject({ status: 402, code: "SUBSCRIPTION_REQUIRED" });
  });

  it("Phase 46: a lapsed-subscription org's free credit consumption is still attempted first (never resets/skips it) -- SUBSCRIPTION_REQUIRED only fires once the (already-0) free credit is also unavailable", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
    // Still has 1 free credit left despite a lapsed subscription (e.g. they
    // signed up, used 1 of 2 free scans, subscribed, then canceled) -- must
    // still be granted via the free credit, not denied with SUBSCRIPTION_REQUIRED.
    const admin = subscriptionAdminStub({
      status: "canceled",
      free_scans_used: 1,
      stripe_subscription_id: "sub_lapsed_456",
    });

    await expect(
      assertOrganizationCanRunScan(admin, "org-1", { id: "user-1", email: "user@example.com" })
    ).resolves.toBeUndefined();
  });

  it("admin bypass email (env allowlist): unaffected by the free-scan limit even with zero credits left", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "admin@example.com");
    // The DB profile row (looked up by the trusted server-derived user id)
    // must itself carry the admin email -- isPlatformAdmin trusts the
    // DB-verified email over whatever a caller passes as `user.email`.
    const admin = subscriptionAdminStub(
      { status: "canceled", free_scans_used: 2 },
      { email: "admin@example.com" }
    );

    await expect(
      assertOrganizationCanRunScan(admin, "org-1", { id: "user-1", email: "admin@example.com" })
    ).resolves.toBeUndefined();
  });

  describe("platform admin (profiles.is_platform_admin, DB-backed)", () => {
    it("grants scan #1, #3, and #100 -- no FREE_SCAN_LIMIT ever applies", async () => {
      vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
      vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
      const admin = subscriptionAdminStub(null, { email: "founder@sequrai.dev", is_platform_admin: true });
      const user = { id: "admin-user", email: "founder@sequrai.dev" };

      for (const attempt of [1, 3, 100]) {
        await expect(
          assertOrganizationCanRunScan(admin, "org-admin", user),
          `attempt #${attempt} should be granted`
        ).resolves.toBeUndefined();
      }
    });

    it("never decrements the Free quota -- the atomic RPC is never even called for a platform admin", async () => {
      vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
      vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
      const admin = subscriptionAdminStub(null, { email: "founder@sequrai.dev", is_platform_admin: true });
      const user = { id: "admin-user", email: "founder@sequrai.dev" };

      for (let i = 0; i < 5; i++) {
        await assertOrganizationCanRunScan(admin, "org-admin", user);
      }

      expect((admin as StubAdmin).rpcCallCount()).toBe(0);
    });

    it("requires no active Stripe subscription -- grants access even with status 'canceled' and 0 credits", async () => {
      vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
      vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
      const admin = subscriptionAdminStub(
        { status: "canceled", free_scans_used: 2 },
        { email: "founder@sequrai.dev", is_platform_admin: true }
      );

      await expect(
        assertOrganizationCanRunScan(admin, "org-admin", { id: "admin-user", email: "founder@sequrai.dev" })
      ).resolves.toBeUndefined();
    });

    it("a normal user cannot impersonate admin by claiming the admin's email in the call -- the DB-verified email (by server-derived id) wins over a caller-passed email", async () => {
      vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
      // The admin allowlist genuinely contains this email...
      vi.stubEnv("SEQURAI_ADMIN_EMAILS", "founder@sequrai.dev");
      // ...but THIS user's real, server-verified profile (looked up by their
      // own id) has is_platform_admin: false and a completely different
      // email. isPlatformAdmin must use the DB-verified email, not the
      // `founder@sequrai.dev` the caller passed as `user.email` -- proving
      // a client cannot grant itself admin by merely claiming that string.
      const admin = subscriptionAdminStub(
        { status: "canceled", free_scans_used: 2 },
        { email: "real-owner@example.com", is_platform_admin: false }
      );

      await expect(
        assertOrganizationCanRunScan(admin, "org-1", {
          id: "attacker-user",
          email: "founder@sequrai.dev", // claimed, not what the DB profile says
        })
      ).rejects.toMatchObject({ status: 402, code: "SCAN_LIMIT_REACHED" });
    });
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
