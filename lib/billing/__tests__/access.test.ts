import { describe, expect, it } from "vitest";
import {
  hasActiveSubscriptionStatus,
  isSubscriptionExemptPath,
  isSubscriptionRequiredPath,
  subscriptionRedirectPath,
} from "@/lib/billing/access";

describe("subscription access helpers", () => {
  it("requires subscription for dashboard and projects", () => {
    expect(isSubscriptionRequiredPath("/dashboard")).toBe(true);
    expect(isSubscriptionRequiredPath("/projects/abc/mission-control")).toBe(true);
    expect(isSubscriptionRequiredPath("/onboarding")).toBe(false);
    expect(isSubscriptionRequiredPath("/billing")).toBe(false);
  });

  it("exempts billing and settings from redirect", () => {
    expect(isSubscriptionExemptPath("/billing")).toBe(true);
    expect(isSubscriptionExemptPath("/settings")).toBe(true);
    expect(subscriptionRedirectPath("/billing")).toBeNull();
  });

  it("redirects unpaid users away from product routes", () => {
    expect(subscriptionRedirectPath("/dashboard")).toBe("/billing?reason=subscription_required");
  });

  it("treats active and trialing as paid", () => {
    expect(hasActiveSubscriptionStatus("active")).toBe(true);
    expect(hasActiveSubscriptionStatus("trialing")).toBe(true);
    expect(hasActiveSubscriptionStatus("canceled")).toBe(false);
    expect(hasActiveSubscriptionStatus(null)).toBe(false);
  });
});
