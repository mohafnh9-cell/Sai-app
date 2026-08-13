import { describe, expect, it } from "vitest";
import { subscriptionRedirectPath } from "@/lib/billing/access";

describe("subscription access paths", () => {
  it("does not redirect dashboard routes (scan-only gating)", () => {
    expect(subscriptionRedirectPath("/dashboard")).toBeNull();
    expect(subscriptionRedirectPath("/projects/abc/mission-control")).toBeNull();
  });
});
