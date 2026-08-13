import { describe, expect, it } from "vitest";
import { isSubscriptionAdminEmail } from "@/lib/billing/admin-access";

describe("isSubscriptionAdminEmail", () => {
  it("matches configured admin emails case-insensitively", () => {
    const previous = process.env.SEQURAI_ADMIN_EMAILS;
    process.env.SEQURAI_ADMIN_EMAILS = "Admin@Example.com,other@test.io";
    expect(isSubscriptionAdminEmail("admin@example.com")).toBe(true);
    expect(isSubscriptionAdminEmail("other@test.io")).toBe(true);
    expect(isSubscriptionAdminEmail("not-admin@example.com")).toBe(false);
    process.env.SEQURAI_ADMIN_EMAILS = previous;
  });
});
