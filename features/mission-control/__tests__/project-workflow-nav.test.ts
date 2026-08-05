import { describe, expect, it } from "vitest";
import { shouldShowSecurityTestNav } from "@/features/mission-control/lib/navigation";

describe("shouldShowSecurityTestNav", () => {
  it("hides when attack center disabled", () => {
    expect(
      shouldShowSecurityTestNav({
        attackCenterEnabled: false,
        hasVerdict: true,
        verdictReadyToShip: false,
      })
    ).toBe(false);
  });

  it("shows when verdict exists and not ready to ship", () => {
    expect(
      shouldShowSecurityTestNav({
        attackCenterEnabled: true,
        hasVerdict: true,
        verdictReadyToShip: false,
      })
    ).toBe(true);
  });

  it("hides on ready to ship unless security test is active", () => {
    expect(
      shouldShowSecurityTestNav({
        attackCenterEnabled: true,
        hasVerdict: true,
        verdictReadyToShip: true,
        securityTestPhase: null,
      })
    ).toBe(false);

    expect(
      shouldShowSecurityTestNav({
        attackCenterEnabled: true,
        hasVerdict: true,
        verdictReadyToShip: true,
        securityTestPhase: "running",
      })
    ).toBe(true);
  });
});
