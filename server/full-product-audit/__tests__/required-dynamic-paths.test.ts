import { describe, expect, it } from "vitest";
import type { AttackHypothesis } from "@/server/attack-simulation/contracts/attack-hypothesis";
import {
  collectRequiredDynamicPaths,
  normalizeRequiredDynamicPath,
} from "../required-dynamic-paths";
import { buildHypothesesFromStaticFindings } from "../build-hypotheses-from-findings";
import type { StaticFindingInput } from "../correlate-findings";

function hypothesis(
  overrides: Partial<AttackHypothesis> & Pick<AttackHypothesis, "id">
): AttackHypothesis {
  return {
    title: "Security headers",
    description: "",
    category: "web",
    severity: "info",
    confidence: 0.9,
    source: "static_finding",
    adapterHint: "security-headers-probe",
    metadata: {},
    ...overrides,
  };
}

describe("required dynamic paths", () => {
  it("collects /forgot-password from a safely mapped hypothesis", () => {
    const paths = collectRequiredDynamicPaths([
      hypothesis({
        id: "finding:security-headers-probe",
        metadata: {
          staticFindingId: "finding-1",
          adapterHint: "security-headers-probe",
          routeMappable: true,
          fixtures: { paths: { securityHeaders: "/forgot-password" } },
        },
      }),
    ]);
    expect(paths).toEqual(["/forgot-password"]);
  });

  it("does not collect paths from unmapped hypotheses", () => {
    const paths = collectRequiredDynamicPaths([
      hypothesis({
        id: "finding:security-headers-probe",
        metadata: {
          staticFindingId: "finding-1",
          adapterHint: "security-headers-probe",
          routeMappable: false,
        },
      }),
    ]);
    expect(paths).toEqual([]);
  });

  it("rejects wildcard and global fallback paths", () => {
    expect(normalizeRequiredDynamicPath("*")).toBeNull();
    expect(normalizeRequiredDynamicPath("/*")).toBeNull();
  });

  it("builds required paths from forgot-password static finding mapping", () => {
    const staticFindings: StaticFindingInput[] = [
      {
        id: "finding-1",
        ruleId: "web-coverage-evaluated",
        title: "Web coverage evaluated",
        description: null,
        severity: "info",
        category: "web",
        filePath: "app/(auth)/forgot-password/page.tsx",
        recommendation: null,
        confidence: "high",
        evidence: null,
      },
    ];
    const built = buildHypothesesFromStaticFindings({
      staticFindings,
      selectedAdapterIds: ["security-headers-probe"],
      requireMappedRoutes: true,
      t: (key) => key,
    });
    expect(collectRequiredDynamicPaths(built.hypotheses)).toEqual(["/forgot-password"]);
  });

  it("does not invent unrelated routes", () => {
    const staticFindings: StaticFindingInput[] = [
      {
        id: "finding-1",
        ruleId: "web-coverage-evaluated",
        title: "Web coverage evaluated",
        description: null,
        severity: "info",
        category: "web",
        filePath: "components/Header.tsx",
        recommendation: null,
        confidence: "high",
        evidence: null,
      },
    ];
    const built = buildHypothesesFromStaticFindings({
      staticFindings,
      selectedAdapterIds: ["security-headers-probe"],
      requireMappedRoutes: true,
      t: (key) => key,
    });
    expect(collectRequiredDynamicPaths(built.hypotheses)).toEqual([]);
  });
});
