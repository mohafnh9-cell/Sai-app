import { describe, expect, it } from "vitest";
import {
  normalizeSeverity,
  severityBadgeClass,
  severitySortOrder,
} from "@/lib/design-system/severity";
import {
  findingVerificationStatus,
  normalizeVerificationStatus,
  verificationBadgeClass,
  verificationIsConfirmed,
} from "@/lib/design-system/verification";
import { verdictSurfaceClass } from "@/lib/design-system/verdict";

describe("design-system severity", () => {
  it("normalizes severity values", () => {
    expect(normalizeSeverity("critical")).toBe("CRITICAL");
    expect(normalizeSeverity("unknown")).toBeNull();
  });

  it("orders severities consistently", () => {
    expect(severitySortOrder("CRITICAL")).toBeLessThan(severitySortOrder("HIGH"));
    expect(severityBadgeClass("CRITICAL")).toContain("severity-critical");
  });
});

describe("design-system verification", () => {
  it("never treats non-confirmed as confirmed", () => {
    expect(verificationIsConfirmed("POTENTIAL")).toBe(false);
    expect(verificationIsConfirmed("CONFIRMED")).toBe(true);
  });

  it("reads verification from finding metadata", () => {
    expect(
      findingVerificationStatus({
        metadata: { securityAnalysis: { verificationStatus: "LIKELY" } },
      })
    ).toBe("LIKELY");
  });

  it("uses distinct styles for confirmed vs potential", () => {
    expect(verificationBadgeClass(normalizeVerificationStatus("CONFIRMED"))).toContain(
      "verification-confirmed"
    );
    expect(verificationBadgeClass(normalizeVerificationStatus("POTENTIAL"))).toContain(
      "verification-potential"
    );
  });
});

describe("design-system verdict surfaces", () => {
  it("maps readiness statuses to semantic tokens", () => {
    expect(verdictSurfaceClass("ready_to_ship")).toContain("readiness-ready");
    expect(verdictSurfaceClass("not_ready")).toContain("readiness-blocked");
  });
});
