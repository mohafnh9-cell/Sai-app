import { describe, expect, it } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildSecurityCoverageReport, runSecurityEngines } from "../orchestrate";
import { persistEngineResults } from "../persistence";
import type { SecurityEngine } from "../types";

function fakeEngine(overrides: Partial<SecurityEngine> & { id: SecurityEngine["id"] }): SecurityEngine {
  return {
    name: overrides.id,
    version: "1.0.0",
    capabilities: [],
    applicability: () => ({ applicable: true, reason: "always", matchedCapabilities: [] }),
    healthCheck: async () => ({ healthy: true, reason: "ok" }),
    execute: async (input) => ({
      engine: overrides.id,
      engineVersion: "1.0.0",
      executionId: "exec-1",
      scanId: input.scanId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5,
      capabilitiesAttempted: [],
      capabilitiesCompleted: [],
      findings: [],
      evidence: [],
      metrics: {},
      errors: [],
    }),
    ...overrides,
  };
}

describe("Phase 35 -- runSecurityEngines orchestration", () => {
  it("runs every applicable engine and SKIPS engines that report not-applicable, without ever calling execute() on them", async () => {
    let executeCalled = false;
    const applicable = fakeEngine({ id: "crypto" });
    const notApplicable = fakeEngine({
      id: "trivy",
      applicability: () => ({ applicable: false, reason: "no dependency manifest", matchedCapabilities: [] }),
      execute: async () => {
        executeCalled = true;
        throw new Error("must not be called");
      },
    });

    const output = await runSecurityEngines(
      { scanId: "scan-1", projectId: "project-1", organizationId: "org-1", files: [] },
      [applicable, notApplicable]
    );

    expect(executeCalled).toBe(false);
    const trivyResult = output.results.find((r) => r.engine === "trivy");
    expect(trivyResult?.status).toBe("SKIPPED");
    expect(trivyResult?.errors[0]?.message).toBe("no dependency manifest");
  });

  it("a single engine crashing does not stop other engines from completing -- engine failure is isolated per-engine (section 22)", async () => {
    const crashing = fakeEngine({
      id: "opengrep",
      execute: async () => {
        throw new Error("boom");
      },
    });
    const healthy = fakeEngine({ id: "crypto" });

    const output = await runSecurityEngines(
      { scanId: "scan-1", projectId: "project-1", organizationId: "org-1", files: [] },
      [crashing, healthy]
    );

    const crashedResult = output.results.find((r) => r.engine === "opengrep");
    const healthyResult = output.results.find((r) => r.engine === "crypto");
    expect(crashedResult?.status).toBe("FAILED");
    expect(crashedResult?.errors[0]?.code).toBe("engine_crashed");
    expect(healthyResult?.status).toBe("COMPLETED");
  });

  it("buildSecurityCoverageReport reflects real per-engine status, never claiming completeness the engines didn't earn", async () => {
    const output = await runSecurityEngines(
      { scanId: "scan-1", projectId: "project-1", organizationId: "org-1", files: [] },
      [fakeEngine({ id: "crypto" }), fakeEngine({ id: "scorecard", applicability: () => ({ applicable: false, reason: "no repo", matchedCapabilities: [] }) })]
    );
    const coverage = buildSecurityCoverageReport(output.results);
    expect(coverage.find((c) => c.engine === "crypto")?.status).toBe("COMPLETED");
    expect(coverage.find((c) => c.engine === "scorecard")?.status).toBe("SKIPPED");
  });
});

describe("Phase 35 -- persistEngineResults tenant isolation (section 36)", () => {
  function tables(): FakeTables {
    return { engine_executions: [], external_engine_findings: [], finding_correlations: [], scan_findings: [] };
  }

  it("persists engine executions and findings scoped to the correct organization/project/scan", async () => {
    const t = tables();
    const admin = createFakeAdmin(t);

    const output = await runSecurityEngines(
      { scanId: "scan-org-a", projectId: "project-a", organizationId: "org-a", files: [{ path: "auth/session.ts", content: "const x = Math.random(); // session token" }] },
      [fakeEngine({
        id: "crypto",
        execute: async (input) => ({
          engine: "crypto",
          engineVersion: "1.0.0",
          executionId: "exec-a",
          scanId: input.scanId,
          projectId: input.projectId,
          organizationId: input.organizationId,
          status: "COMPLETED",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 5,
          capabilitiesAttempted: ["cryptography"],
          capabilitiesCompleted: ["cryptography"],
          findings: [
            {
              id: "crypto:finding-a",
              fingerprint: "fp-a",
              title: "weak random",
              description: "d",
              category: "cryptography",
              severity: "high",
              confidence: "medium",
              exploitability: { level: "LOW", confidence: 0.3, evidenceIds: [] },
              verificationStatus: "POTENTIAL",
              sources: ["native_scanner"],
              evidence: [],
              affectedFiles: ["auth/session.ts"],
              affectedEndpoints: [],
              affectedAssets: [],
              remediation: null,
              references: [],
              cwe: [],
              owasp: [],
              mitre: [],
              scanId: input.scanId,
              projectId: input.projectId,
              organizationId: input.organizationId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          evidence: [],
          metrics: {},
          errors: [],
        }),
      })]
    );

    const result = await persistEngineResults(admin as never, {
      organizationId: "org-a",
      projectId: "project-a",
      scanId: "scan-org-a",
      results: output.results,
    });

    expect(result.findingsPersisted).toBe(1);
    expect(t.external_engine_findings?.[0]).toMatchObject({ organization_id: "org-a", project_id: "project-a", scan_id: "scan-org-a" });

    // Cross-tenant isolation: an org-b read filtered by organization_id must
    // never see org-a's persisted finding.
    const orgBRows = (t.external_engine_findings ?? []).filter((r) => r.organization_id === "org-b");
    expect(orgBRows).toHaveLength(0);
  });
});
