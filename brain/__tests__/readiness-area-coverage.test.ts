import { describe, expect, it } from "vitest";
import { assessCoverage } from "@/brain/production-verdict/coverage";
import type { NormalizedFinding } from "@/brain/production-verdict/normalize-finding";
import { scanRepository } from "@/features/security-scanner";

function baselineFinding(
  area: string,
  level: "partial" | "evaluated"
): NormalizedFinding {
  return {
    id: `${area}-baseline`,
    title: `${area} baseline`,
    severity: "info",
    category: area,
    ruleId: "readiness.area-baseline",
    confidence: "high",
    evidence: `area=${area};level=${level}`,
  };
}

describe("readiness area coverage", () => {
  it("marks the five former gaps as evaluated when baseline findings are present", () => {
    const findings: NormalizedFinding[] = [
      baselineFinding("dependencies", "evaluated"),
      baselineFinding("testing", "evaluated"),
      baselineFinding("performance", "evaluated"),
      baselineFinding("observability", "evaluated"),
      baselineFinding("reliability", "evaluated"),
    ];

    const coverage = assessCoverage({
      findings,
      securityScore: 91,
      filesAnalyzed: 120,
    });

    for (const key of [
      "dependencies",
      "testing",
      "performance",
      "observability",
      "reliability",
    ] as const) {
      expect(coverage.unevaluatedAreas.some((area) => area.key === key)).toBe(false);
      expect(
        [...coverage.evaluatedAreas, ...coverage.partiallyEvaluatedAreas].some(
          (area) => area.key === key
        )
      ).toBe(true);
    }
  });

  it("emits readiness baselines for sequrai-app shaped trees", async () => {
    const result = await scanRepository([
      { path: "package.json", content: '{"dependencies":{"next":"16"}}' },
      { path: "package-lock.json", content: "{}" },
      { path: "vitest.config.ts", content: "export default {}" },
      { path: "server/observability/metrics.ts", content: "export {}" },
      { path: "server/observability/operational-events.ts", content: "export {}" },
      { path: "inngest/functions/scan-job-recovery.ts", content: "export {}" },
      { path: "server/observability/idempotency.ts", content: "export {}" },
      { path: "server/cache/read-cache.ts", content: "export {}" },
      { path: "server/observability/operation-timing.ts", content: "export {}" },
      { path: "next.config.ts", content: "export default {}" },
      ...Array.from({ length: 6 }, (_, index) => ({
        path: `lib/__tests__/sample-${index}.test.ts`,
        content: "test('x', () => {})",
      })),
    ]);

    const baselines = result.findings.filter((f) => f.ruleId === "readiness.area-baseline");
    expect(baselines.length).toBeGreaterThanOrEqual(5);
    expect(baselines.map((f) => f.category).sort()).toEqual(
      expect.arrayContaining([
        "dependencies",
        "observability",
        "performance",
        "reliability",
        "testing",
      ])
    );
  });
});
