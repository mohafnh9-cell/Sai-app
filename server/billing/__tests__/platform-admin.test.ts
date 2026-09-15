import { afterEach, describe, expect, it, vi } from "vitest";
import { isPlatformAdmin } from "../platform-admin";

function fakeAdmin(profile: { email?: string; is_platform_admin?: boolean } | null) {
  return {
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: profile, error: null }),
          }),
        }),
      };
    },
  } as never;
}

describe("isPlatformAdmin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true when profiles.is_platform_admin is set (DB-backed, authoritative)", async () => {
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
    const admin = fakeAdmin({ email: "founder@sequrai.dev", is_platform_admin: true });

    await expect(isPlatformAdmin(admin, { id: "user-1" })).resolves.toBe(true);
  });

  it("falls back to the SEQURAI_ADMIN_EMAILS allowlist when the DB flag is false, using the DB-verified email", async () => {
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "founder@sequrai.dev");
    const admin = fakeAdmin({ email: "founder@sequrai.dev", is_platform_admin: false });

    await expect(isPlatformAdmin(admin, { id: "user-1" })).resolves.toBe(true);
  });

  it("returns false for an ordinary user (no DB flag, email not in the allowlist)", async () => {
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "founder@sequrai.dev");
    const admin = fakeAdmin({ email: "customer@example.com", is_platform_admin: false });

    await expect(isPlatformAdmin(admin, { id: "user-2" })).resolves.toBe(false);
  });

  it("trusts the DB-verified email over a caller-supplied user.email -- a client cannot grant itself admin by claiming a known admin address", async () => {
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "founder@sequrai.dev");
    // The profile actually on file for this id is NOT an admin.
    const admin = fakeAdmin({ email: "customer@example.com", is_platform_admin: false });

    await expect(
      isPlatformAdmin(admin, { id: "user-2", email: "founder@sequrai.dev" })
    ).resolves.toBe(false);
  });

  it("returns false when there is no profile row and no matching allowlist entry", async () => {
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
    const admin = fakeAdmin(null);

    await expect(isPlatformAdmin(admin, { id: "user-3", email: "someone@example.com" })).resolves.toBe(
      false
    );
  });

  it("respects auth-bypass dev mode regardless of DB state", async () => {
    vi.stubEnv("SEQURAI_ADMIN_EMAILS", "");
    vi.stubEnv("SEQURAI_BYPASS_AUTH", "true");
    const admin = fakeAdmin({ email: "customer@example.com", is_platform_admin: false });

    await expect(isPlatformAdmin(admin, { id: "user-4" })).resolves.toBe(true);
  });
});
