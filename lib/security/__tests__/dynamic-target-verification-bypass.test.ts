import { afterEach, describe, expect, it } from "vitest";
import { isDynamicTargetVerificationBypassEnabled } from "@/lib/security/dynamic-target-verification-bypass";

describe("isDynamicTargetVerificationBypassEnabled", () => {
  const backup = { ...process.env };

  afterEach(() => {
    process.env = { ...backup };
  });

  it("honors SEQURAI_SKIP_TARGET_VERIFICATION outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    process.env.SEQURAI_SKIP_TARGET_VERIFICATION = "true";
    expect(isDynamicTargetVerificationBypassEnabled("user@example.com")).toBe(true);
  });

  it("ignores SEQURAI_SKIP_TARGET_VERIFICATION in production", () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    delete process.env.SEQURAI_SKIP_TARGET_VERIFICATION;
    expect(isDynamicTargetVerificationBypassEnabled("user@example.com")).toBe(false);
  });

  it("honors admin emails in production", () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.SEQURAI_ADMIN_EMAILS = "admin@example.com";
    process.env.SEQURAI_SKIP_TARGET_VERIFICATION = "false";
    expect(isDynamicTargetVerificationBypassEnabled("admin@example.com")).toBe(true);
    expect(isDynamicTargetVerificationBypassEnabled("other@example.com")).toBe(false);
  });
});
