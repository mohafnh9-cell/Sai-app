import { describe, expect, it } from "vitest";
import { shouldShowSecurityTestNav } from "@/features/mission-control/lib/navigation";

describe("shouldShowSecurityTestNav", () => {
  it("hides when attack center disabled", () => {
    expect(
      shouldShowSecurityTestNav({
        attackCenterEnabled: false,
      })
    ).toBe(false);
  });

  it("shows when attack center enabled", () => {
    expect(
      shouldShowSecurityTestNav({
        attackCenterEnabled: true,
      })
    ).toBe(true);
  });
});
