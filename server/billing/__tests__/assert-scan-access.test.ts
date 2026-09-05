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
function subscriptionAdminStub(subscriptionRow: { status: string } | null) {
  return {
    from: (table: string) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: subscriptionRow, error: null }),
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

  it("billing enabled + no active subscription: rejects with a 402 ScanRequestError", async () => {
    vi.stubEnv("SEQURAI_BILLING_ENABLED", "true");
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
    const admin = subscriptionAdminStub(null);

    await expect(
      assertOrganizationCanRunScan(admin, "org-1", { id: "user-1", email: "user@example.com" })
    ).rejects.toBeInstanceOf(ScanRequestError);

    try {
      await assertOrganizationCanRunScan(admin, "org-1", { id: "user-1", email: "user@example.com" });
      throw new Error("expected assertOrganizationCanRunScan to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ScanRequestError);
      expect((error as InstanceType<typeof ScanRequestError>).status).toBe(402);
    }
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
