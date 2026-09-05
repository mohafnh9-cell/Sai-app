import { describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

const SCAN_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/server/ai-reasoning/run-scan-reasoning", () => ({
  runScanAiReasoning: vi.fn(async () => {
    throw new Error("simulated AI reasoning crash");
  }),
}));

vi.mock("@/server/attack-simulation/integration/build-verdict-overlay", () => ({
  buildAttackSimulationVerdictOverlay: vi.fn(async () => null),
}));

vi.mock("@/server/observability/operational-events", () => ({
  emitOperationalEvent: vi.fn(async () => undefined),
}));

vi.mock("@/server/observability/idempotency", () => ({
  buildIdempotencyKey: vi.fn(() => "key"),
  hasCompletedSideEffect: vi.fn(async () => false),
  recordSideEffect: vi.fn(async () => undefined),
}));

vi.mock("@/server/production-memory/record-writes", () => ({
  recordReviewCompletedMemory: vi.fn(async () => undefined),
}));

function buildTables(): FakeTables {
  return {
    scans: [
      {
        id: SCAN_ID,
        project_id: PROJECT_ID,
        repository_id: PROJECT_ID,
        organization_id: ORG_ID,
        status: "completed",
        commit_sha: "abc123",
        branch: "main",
        security_score: 92,
        files_analyzed: 12,
        files_discovered: 12,
        immutability_locked_at: null,
      },
    ],
    scan_findings: [
      {
        id: "finding-1",
        scan_id: SCAN_ID,
        title: "Hard-coded secret",
        severity: "critical",
        category: "secrets",
        rule_id: "secrets.exposed",
        file_path: "lib/config.ts",
        start_line: 3,
        recommendation: "Rotate it",
        confidence: "high",
        evidence: "sk_live_x",
        metadata: {},
      },
    ],
    production_verdicts: [],
    ai_reports: [],
    repository_scan_state: [],
  };
}

describe("Phase 30 -- runtime integration: AI reasoning failure never blocks Production Verdict", () => {
  it("Q/A/B: even when the AI reasoning stage throws, the deterministic verdict is still generated and persisted with the correct (unmodified) status/severity", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const admin = createFakeAdmin(buildTables());

    const verdict = await generateAndPersistProductionVerdict(admin as never, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      scanId: SCAN_ID,
    });

    expect(verdict).not.toBeNull();
    // A critical finding must still drive the deterministic status to
    // not_ready -- unaffected by the AI reasoning stage crashing.
    expect(verdict?.status).toBe("not_ready");
    expect(verdict?.criticalBlockersCount).toBeGreaterThan(0);

    const { runScanAiReasoning } = await import("@/server/ai-reasoning/run-scan-reasoning");
    expect(runScanAiReasoning).toHaveBeenCalledTimes(1);
  });
});
