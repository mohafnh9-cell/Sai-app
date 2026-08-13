import { describe, expect, it } from "vitest";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";

describe("isBillingEnabled", () => {
  it("is false by default", () => {
    const server = process.env.SEQURAI_BILLING_ENABLED;
    const client = process.env.NEXT_PUBLIC_SEQURAI_BILLING_ENABLED;
    delete process.env.SEQURAI_BILLING_ENABLED;
    delete process.env.NEXT_PUBLIC_SEQURAI_BILLING_ENABLED;
    expect(isBillingEnabled()).toBe(false);
    process.env.SEQURAI_BILLING_ENABLED = server;
    process.env.NEXT_PUBLIC_SEQURAI_BILLING_ENABLED = client;
  });

  it("enables when SEQURAI_BILLING_ENABLED is true", () => {
    const previous = process.env.SEQURAI_BILLING_ENABLED;
    process.env.SEQURAI_BILLING_ENABLED = "true";
    expect(isBillingEnabled()).toBe(true);
    process.env.SEQURAI_BILLING_ENABLED = previous;
  });
});
