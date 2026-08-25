import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/dev-bypass", () => ({
  isAuthBypassEnabled: vi.fn(() => false),
}));

import { isAppAdminEmail } from "@/lib/auth/is-app-admin";
import { isAuthBypassEnabled } from "@/lib/auth/dev-bypass";

describe("isAppAdminEmail", () => {
  const previous = process.env.SEQURAI_ADMIN_EMAILS;

  afterEach(() => {
    process.env.SEQURAI_ADMIN_EMAILS = previous;
    vi.mocked(isAuthBypassEnabled).mockReturnValue(false);
  });

  it("matches only the configured admin email, case-insensitively", () => {
    process.env.SEQURAI_ADMIN_EMAILS = "moha.fnh.9@gmail.com";
    expect(isAppAdminEmail("moha.fnh.9@gmail.com")).toBe(true);
    expect(isAppAdminEmail("MOHA.FNH.9@GMAIL.COM")).toBe(true);
  });

  it("rejects any other account, including real test users", () => {
    process.env.SEQURAI_ADMIN_EMAILS = "moha.fnh.9@gmail.com";
    expect(isAppAdminEmail("gianni.ev93@gmail.com")).toBe(false);
    expect(isAppAdminEmail("aleiestudio@gmail.com")).toBe(false);
    expect(isAppAdminEmail("moha.fnh.9@gmail.com.evil.com")).toBe(false);
    expect(isAppAdminEmail(null)).toBe(false);
    expect(isAppAdminEmail(undefined)).toBe(false);
  });

  it("denies everyone when the env var is unset", () => {
    delete process.env.SEQURAI_ADMIN_EMAILS;
    expect(isAppAdminEmail("moha.fnh.9@gmail.com")).toBe(false);
  });

  it("only bypasses the check when dev auth bypass is enabled", () => {
    process.env.SEQURAI_ADMIN_EMAILS = "moha.fnh.9@gmail.com";
    vi.mocked(isAuthBypassEnabled).mockReturnValue(true);
    expect(isAppAdminEmail("anyone@example.com")).toBe(true);
  });
});
