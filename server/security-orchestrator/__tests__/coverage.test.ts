import { describe, expect, it } from "vitest";
import { buildCoverageReport } from "../coverage";
import type { EngineId, EngineResult } from "@/server/security-engines/types";
import type { SecurityPlan } from "../types";

function fakePlan(decisions: SecurityPlan["decisions"]): SecurityPlan {
  return {
    planId: "plan-1",
    scanId: "scan-1",
    organizationId: "org-1",
    projectId: "project-1",
    applicationSurface: {} as SecurityPlan["applicationSurface"],
    depth: "STANDARD",
    decisions,
    selectedEngines: decisions.filter((d) => d.selected).map((d) => d.engine),
    dynamicTestingAvailable: false,
    dynamicTestingReason: "n/a",
    createdAt: new Date().toISOString(),
  };
}

function fakeResult(overrides: Partial<EngineResult> & { engine: EngineId }): EngineResult {
  return {
    engineVersion: "1.0.0",
    executionId: "exec-1",
    scanId: "scan-1",
    projectId: "project-1",
    organizationId: "org-1",
    status: "COMPLETED",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 10,
    capabilitiesAttempted: [],
    capabilitiesCompleted: [],
    findings: [],
    evidence: [],
    metrics: {},
    errors: [],
    ...overrides,
  };
}

describe("Phase 36 -- buildCoverageReport (section 8/21/60: six distinct states)", () => {
  it("NOT_APPLICABLE: an engine the plan never selected is never counted as executed/clean", () => {
    const plan = fakePlan([{ engine: "trivy", selected: false, capabilities: [], rationale: "no manifest" }]);
    const report = buildCoverageReport(plan, new Map());
    expect(report.entries[0]?.status).toBe("NOT_APPLICABLE");
    expect(report.clean).toBe(0);
    expect(report.executed).toBe(0);
  });

  it("UNAVAILABLE: a selected engine with no result yet (job still queued/running) is never reported as clean", () => {
    const plan = fakePlan([{ engine: "opengrep", selected: true, capabilities: [], rationale: "applicable" }]);
    const report = buildCoverageReport(plan, new Map());
    expect(report.entries[0]?.status).toBe("UNAVAILABLE");
    expect(report.unavailable).toBe(1);
    expect(report.clean).toBe(0);
  });

  it("SKIPPED: an EngineResult with status SKIPPED (e.g. binary not configured) is never reported as clean", () => {
    const plan = fakePlan([{ engine: "trivy", selected: true, capabilities: [], rationale: "applicable" }]);
    const report = buildCoverageReport(plan, new Map([["trivy", fakeResult({ engine: "trivy", status: "SKIPPED" })]]));
    expect(report.entries[0]?.status).toBe("SKIPPED");
    expect(report.skipped).toBe(1);
    expect(report.clean).toBe(0);
  });

  it("FAILED: an engine crash is never reported as clean", () => {
    const plan = fakePlan([{ engine: "opengrep", selected: true, capabilities: [], rationale: "applicable" }]);
    const report = buildCoverageReport(plan, new Map([["opengrep", fakeResult({ engine: "opengrep", status: "FAILED" })]]));
    expect(report.entries[0]?.status).toBe("FAILED");
    expect(report.failed).toBe(1);
    expect(report.clean).toBe(0);
  });

  it("COMPLETED_CLEAN vs COMPLETED_WITH_FINDINGS are distinguished by actual findings, not assumed", () => {
    const plan = fakePlan([
      { engine: "crypto", selected: true, capabilities: [], rationale: "applicable" },
      { engine: "native", selected: true, capabilities: [], rationale: "applicable" },
    ]);
    const report = buildCoverageReport(
      plan,
      new Map([
        ["crypto", fakeResult({ engine: "crypto", status: "COMPLETED", findings: [] })],
        [
          "native",
          fakeResult({
            engine: "native",
            status: "COMPLETED",
            findings: [{ id: "f1" } as never],
          }),
        ],
      ])
    );
    expect(report.clean).toBe(1);
    expect(report.withFindings).toBe(1);
  });
});
