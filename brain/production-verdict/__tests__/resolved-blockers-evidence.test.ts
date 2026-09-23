import { describe, expect, it } from "vitest";
import { generateProductionVerdict } from "@/brain/production-verdict/engine";

// Phase Z v2 Pass 3 (CRIT-006): "resolved" must mean the scan that reports it
// actually looked. A lower blocker count from a scan that failed, was partial,
// or barely covered the repository is absence of evidence, not a fix.
function highFinding(id: string) {
  return {
    id,
    title: `High issue ${id}`,
    severity: "high",
    category: "authorization",
    rule_id: "authz.ownership",
    file_path: `app/api/${id}/route.ts`,
    start_line: 10,
    confidence: "high",
  };
}

function run(overrides: Partial<Parameters<typeof generateProductionVerdict>[0]> = {}) {
  return generateProductionVerdict({
    projectId: "11111111-1111-4111-8111-111111111111",
    repositoryId: "11111111-1111-4111-8111-111111111111",
    scanId: "22222222-2222-4222-8222-222222222222",
    scanStatus: "completed",
    securityScore: 80,
    filesAnalyzed: 120,
    filesDiscovered: 120,
    previousBlockersCount: 3,
    findings: [highFinding("a")],
    ...overrides,
  }).verdict;
}

describe("resolvedBlockers requires evidence that the scan actually looked", () => {
  it("reports resolved blockers for a complete, sufficiently covered scan", () => {
    expect(run().resolvedBlockers).toBe(2);
  });

  it("does not report resolved blockers when the scan was partial (engine or rule failure)", () => {
    expect(run({ partialScanFailure: true }).resolvedBlockers).toBe(0);
  });

  it("does not report resolved blockers when coverage was insufficient", () => {
    expect(run({ filesAnalyzed: 3, filesDiscovered: 5000 }).resolvedBlockers).toBe(0);
  });

  it("does not report resolved blockers when the scan failed", () => {
    expect(run({ scanStatus: "failed" }).resolvedBlockers).toBe(0);
  });

  it("still reports newly visible blockers even when coverage is incomplete", () => {
    const verdict = run({
      partialScanFailure: true,
      previousBlockersCount: 0,
      findings: [highFinding("a"), highFinding("b")],
    });
    expect(verdict.introducedBlockers).toBeGreaterThan(0);
    expect(verdict.resolvedBlockers).toBe(0);
  });
});
