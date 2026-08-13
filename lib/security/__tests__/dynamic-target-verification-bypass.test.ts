import { describe, expect, it } from "vitest";
import { isDynamicTargetVerificationBypassEnabled } from "@/lib/security/dynamic-target-verification-bypass";

describe("isDynamicTargetVerificationBypassEnabled", () => {
  it("honors SEQURAI_SKIP_TARGET_VERIFICATION", () => {
    const previous = process.env.SEQURAI_SKIP_TARGET_VERIFICATION;
    process.env.SEQURAI_SKIP_TARGET_VERIFICATION = "true";
    expect(isDynamicTargetVerificationBypassEnabled("user@example.com")).toBe(true);
    process.env.SEQURAI_SKIP_TARGET_VERIFICATION = previous;
  });

  it("honors admin emails", () => {
    const previous = process.env.SEQURAI_ADMIN_EMAILS;
    process.env.SEQURAI_ADMIN_EMAILS = "admin@example.com";
    process.env.SEQURAI_SKIP_TARGET_VERIFICATION = "false";
    expect(isDynamicTargetVerificationBypassEnabled("admin@example.com")).toBe(true);
    expect(isDynamicTargetVerificationBypassEnabled("other@example.com")).toBe(false);
    process.env.SEQURAI_ADMIN_EMAILS = previous;
  });
});
