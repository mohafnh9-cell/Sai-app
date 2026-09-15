import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

/**
 * Phase 38: proves executeUnifiedScanRedTeamPhase calls the canonical
 * SecurityOrchestrator (Phase 36) rather than Phase 35's direct
 * runSecurityEngines()/createSecurityJob calls that previously lived here --
 * the real fix this phase made. Both review_now and full_product_audit flow
 * through this one function (Phase 34's single-execution-path design), so
 * this is the regression test for "MCP now calls the canonical orchestrator."
 */

vi.mock("../run-scan-red-team", () => ({
  runScanRedTeamPipeline: vi.fn(async () => ({
    status: "completed",
    ids: { scanId: "scan-1", scanJobId: "job-1", correlationId: "c1", executionId: "e1", decisionId: null, directorRequestId: "r1" },
    // Non-null report is required to reach the orchestration stage (a null
    // report takes the function's early-return path instead) -- the exact
    // shape doesn't matter beyond that since buildScanJobPlatformMetadata
    // is mocked below rather than given a fully valid RedTeamReport.
    report: { intelligence: null, results: [] },
    securityDecision: null,
    errorMessage: null,
    durationMs: 5,
  })),
}));

vi.mock("../build-scan-metadata", () => ({
  buildScanJobPlatformMetadata: vi.fn(() => ({ version: "1.0.0", ids: {}, pipelineStatus: "completed", teamExecution: {}, completedAt: new Date().toISOString() })),
}));

vi.mock("../persist-scan-platform", () => ({
  persistScanJobPlatformMetadata: vi.fn(async () => undefined),
  attachPlatformSummaryToScan: vi.fn(async () => undefined),
}));

const orchestrationSpy = vi.fn(async () => ({}));
vi.mock("@/server/security-orchestrator/orchestrate", () => ({
  runSecurityOrchestration: orchestrationSpy,
}));

const legacyEnginesSpy = vi.fn();
vi.mock("@/server/security-engines/orchestrate", () => ({
  runSecurityEngines: legacyEnginesSpy,
}));

vi.mock("@/server/attack-simulation/integration/run-scan-attack-simulation-phase", () => ({
  runScanAttackSimulationPhase: vi.fn(async () => null),
}));

vi.mock("@/server/ai-red-team/intelligence/persistence", () => ({
  persistSecurityIntelligence: vi.fn(async () => undefined),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  orchestrationSpy.mockClear();
  legacyEnginesSpy.mockClear();
});

describe("Phase 38 -- executeUnifiedScanRedTeamPhase calls the canonical orchestrator", () => {
  it("calls runSecurityOrchestration() and never the legacy Phase 35 runSecurityEngines() directly", async () => {
    const { executeUnifiedScanRedTeamPhase } = await import("../execute-unified-scan-pipeline");
    const t: FakeTables = { projects: [{ id: "project-1", github_repo: "acme/widgets" }] };
    const admin = createFakeAdmin(t);

    await executeUnifiedScanRedTeamPhase(admin as never, {
      scanId: "scan-1",
      scanJobId: "job-1",
      organizationId: "org-1",
      projectId: "project-1",
      commitSha: "abc123",
      files: [{ path: "app.ts", content: "const x = 1;" }],
    });

    expect(orchestrationSpy).toHaveBeenCalledTimes(1);
    expect(orchestrationSpy).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        scanId: "scan-1",
        organizationId: "org-1",
        projectId: "project-1",
        githubRepo: "acme/widgets",
        depth: "STANDARD",
      })
    );
    expect(legacyEnginesSpy).not.toHaveBeenCalled();
  });

  it("drains inline (drainInline: true) when no Security Execution Worker is configured -- preserves the pre-Phase-38 fallback behavior", async () => {
    vi.stubEnv("SECURITY_WORKER_ENABLED", "");
    const { executeUnifiedScanRedTeamPhase } = await import("../execute-unified-scan-pipeline");
    const t: FakeTables = { projects: [{ id: "project-1", github_repo: "acme/widgets" }] };
    const admin = createFakeAdmin(t);

    await executeUnifiedScanRedTeamPhase(admin as never, {
      scanId: "scan-1",
      scanJobId: "job-1",
      organizationId: "org-1",
      projectId: "project-1",
      commitSha: "abc123",
      files: [],
    });

    expect(orchestrationSpy).toHaveBeenCalledWith(admin, expect.objectContaining({ drainInline: true }));
  });

  it("does NOT drain inline when a Security Execution Worker IS configured -- jobs are left for that worker to claim", async () => {
    vi.stubEnv("SECURITY_WORKER_ENABLED", "true");
    const { executeUnifiedScanRedTeamPhase } = await import("../execute-unified-scan-pipeline");
    const t: FakeTables = { projects: [{ id: "project-1", github_repo: "acme/widgets" }] };
    const admin = createFakeAdmin(t);

    await executeUnifiedScanRedTeamPhase(admin as never, {
      scanId: "scan-1",
      scanJobId: "job-1",
      organizationId: "org-1",
      projectId: "project-1",
      commitSha: "abc123",
      files: [],
    });

    expect(orchestrationSpy).toHaveBeenCalledWith(admin, expect.objectContaining({ drainInline: false }));
  });
});
