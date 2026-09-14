import { describe, expect, it } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { loadNativeEngineResult } from "../native-coverage";
import { buildCoverageReport } from "../coverage";
import type { SecurityPlan } from "../types";
import type { EngineId, EngineResult } from "@/server/security-engines/types";

function fakePlan(): SecurityPlan {
  return {
    planId: "plan-1",
    scanId: "scan-1",
    organizationId: "org-1",
    projectId: "project-1",
    applicationSurface: {
      stack: { languages: ["TypeScript"], frameworks: [], services: [], packageManagers: [], dependencies: {} },
      hasDockerfile: false,
      hasIacFiles: false,
      hasGithubActions: false,
      hasMcpIndicators: false,
      hasDependencyManifest: true,
      githubRepo: null,
      fileCount: 1,
    },
    depth: "STANDARD",
    decisions: [{ engine: "native", selected: true, capabilities: [], rationale: "always applicable" }],
    selectedEngines: ["native"],
    dynamicTestingAvailable: false,
    dynamicTestingReason: "n/a",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Phase 38, section 10 regression test: before this fix, "native" had no
 * SecurityJob/EngineResult, so buildCoverageReport() always classified it as
 * UNAVAILABLE even when the native 47-rule scanner genuinely ran and
 * persisted findings to scan_findings for this exact scan. This proves
 * loadNativeEngineResult() reads that one source of truth (no second
 * execution, no second mapping) and that coverage now reflects it correctly.
 */
describe("Phase 38 -- native coverage (loadNativeEngineResult)", () => {
  it("reports COMPLETED_WITH_FINDINGS when scan_findings has rows for this scan", async () => {
    const t: FakeTables = {
      scan_findings: [
        {
          id: "f1",
          scan_id: "scan-1",
          title: "SQL injection",
          description: "d",
          severity: "high",
          category: "injection",
          file_path: "app.ts",
          start_line: 10,
          recommendation: null,
          confidence: "high",
          metadata: {},
        },
      ],
    };
    const admin = createFakeAdmin(t);

    const nativeResult = await loadNativeEngineResult(admin as never, {
      scanId: "scan-1",
      projectId: "project-1",
      organizationId: "org-1",
    });

    expect(nativeResult.status).toBe("COMPLETED");
    expect(nativeResult.findings).toHaveLength(1);
    expect(nativeResult.findings[0]?.title).toBe("SQL injection");

    const results = new Map<EngineId, EngineResult>([["native", nativeResult]]);
    const coverage = buildCoverageReport(fakePlan(), results);
    const nativeEntry = coverage.entries.find((e) => e.engine === "native");
    expect(nativeEntry?.status).toBe("COMPLETED_WITH_FINDINGS");
    expect(nativeEntry?.status).not.toBe("UNAVAILABLE");
  });

  it("reports COMPLETED_CLEAN (never UNAVAILABLE) when native ran but found nothing for this scan", async () => {
    const t: FakeTables = { scan_findings: [] };
    const admin = createFakeAdmin(t);

    const nativeResult = await loadNativeEngineResult(admin as never, {
      scanId: "scan-1",
      projectId: "project-1",
      organizationId: "org-1",
    });

    expect(nativeResult.status).toBe("COMPLETED");
    expect(nativeResult.findings).toHaveLength(0);

    const results = new Map<EngineId, EngineResult>([["native", nativeResult]]);
    const coverage = buildCoverageReport(fakePlan(), results);
    const nativeEntry = coverage.entries.find((e) => e.engine === "native");
    expect(nativeEntry?.status).toBe("COMPLETED_CLEAN");
    expect(nativeEntry?.status).not.toBe("UNAVAILABLE");
  });

  it("without this fix (no native entry in results), coverage falls back to UNAVAILABLE -- proves the bug this fix resolves", () => {
    const results = new Map<EngineId, EngineResult>();
    const coverage = buildCoverageReport(fakePlan(), results);
    const nativeEntry = coverage.entries.find((e) => e.engine === "native");
    expect(nativeEntry?.status).toBe("UNAVAILABLE");
  });

  it("scopes findings to the given scanId only -- another scan's findings never leak into this one's coverage", async () => {
    const t: FakeTables = {
      scan_findings: [
        { id: "f-other", scan_id: "scan-OTHER", title: "unrelated", description: "", severity: "low", category: "x", file_path: null, start_line: null, recommendation: null, confidence: "low", metadata: {} },
      ],
    };
    const admin = createFakeAdmin(t);

    const nativeResult = await loadNativeEngineResult(admin as never, {
      scanId: "scan-1",
      projectId: "project-1",
      organizationId: "org-1",
    });

    expect(nativeResult.findings).toHaveLength(0);
  });
});
