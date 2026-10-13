import { describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

// 2026-10-13 acceptance: after D9, a real manual analysis generated its verdict 1 s after the last engine finished, but
// scans.metrics.verdictEvidence (which engines the verdict was computed from) existed on NO scan of the project. The scan's
// updated_at showed no write after the evidence marker. These tests pin the persistence down: every path that creates a verdict
// records it, a failed or conflicting write is retried/reported (never silent), and other metrics keys are never lost.

const SCAN_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/server/ai-reasoning/run-scan-reasoning", () => ({ runScanAiReasoning: vi.fn(async () => undefined) }));
vi.mock("@/server/attack-simulation/integration/build-verdict-overlay", () => ({ buildAttackSimulationVerdictOverlay: vi.fn(async () => null) }));
vi.mock("@/server/observability/operational-events", () => ({ emitOperationalEvent: vi.fn(async () => undefined) }));
vi.mock("@/server/observability/idempotency", () => ({
  buildIdempotencyKey: vi.fn(() => "key"),
  hasCompletedSideEffect: vi.fn(async () => false),
  recordSideEffect: vi.fn(async () => undefined),
}));
vi.mock("@/server/production-memory/record-writes", () => ({ recordReviewCompletedMemory: vi.fn(async () => undefined) }));

const baseMetrics = { rulesRun: 47, platformExecution: { stage: "done" }, verdictEvidenceReadyAt: "2026-10-13T13:04:31.222Z" };

function tables(metrics: Record<string, unknown> = baseMetrics): FakeTables {
  return {
    scans: [{ id: SCAN_ID, project_id: PROJECT_ID, repository_id: PROJECT_ID, organization_id: ORG_ID, status: "completed", commit_sha: "abc123", branch: "main",
      security_score: 92, files_analyzed: 12, files_discovered: 12, immutability_locked_at: null, metrics, updated_at: "2026-10-13T13:04:31.287Z" }],
    scan_findings: [],
    security_jobs: ["opengrep", "trivy", "crypto"].map((engine, i) => ({ id: `job-${i}`, scan_id: SCAN_ID, organization_id: ORG_ID, project_id: PROJECT_ID, engine, status: "COMPLETED" })),
    production_verdicts: [], ai_reports: [], repository_scan_state: [],
  };
}
// The in-memory admin mutates the tables object it is given: tests keep a reference to it.
let current: FakeTables = tables();
const scanOf = (_admin?: unknown) => (current.scans as Array<Record<string, unknown>>)[0];
const metricsOf = (_admin?: unknown) => scanOf().metrics as Record<string, unknown>;
const freshAdmin = (t: FakeTables = tables()) => {
  current = t;
  return createFakeAdmin(t);
};

describe("the canonical generator records which engines the verdict came from (every path goes through it)", () => {
  it("a verdict created directly by the generator (the runner's path) leaves verdictEvidence, and keeps the other keys", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const admin = freshAdmin();
    const verdict = await generateAndPersistProductionVerdict(admin as never, { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID });
    expect(verdict).not.toBeNull();
    const metrics = metricsOf(admin);
    expect(metrics.verdictEvidence).toMatchObject({
      finalizedBy: "pipeline",
      externalEngines: [
        { engine: "opengrep", status: "COMPLETED" },
        { engine: "trivy", status: "COMPLETED" },
        { engine: "crypto", status: "COMPLETED" },
      ],
    });
    expect(metrics.rulesRun).toBe(47);
    expect(metrics.platformExecution).toEqual({ stage: "done" });
    expect(metrics.verdictEvidenceReadyAt).toBe("2026-10-13T13:04:31.222Z");
  });

  it("a failed engine stays visible as failed in the record (never turned into success)", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const t = tables();
    (t.security_jobs as Array<Record<string, unknown>>)[1].status = "TIMED_OUT";
    const admin = freshAdmin(t);
    await generateAndPersistProductionVerdict(admin as never, { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID });
    expect((metricsOf(admin).verdictEvidence as { externalEngines: Array<{ engine: string; status: string }> }).externalEngines).toContainEqual({ engine: "trivy", status: "TIMED_OUT" });
  });

  it("a scan with no engine jobs is recorded as 'not_run', not as an empty success", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const t = tables();
    t.security_jobs = [];
    const admin = freshAdmin(t);
    await generateAndPersistProductionVerdict(admin as never, { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID });
    expect((metricsOf(admin).verdictEvidence as { externalEngines: unknown }).externalEngines).toBe("not_run");
  });

  it("the first record wins: generating again (reuse) does not rewrite what the verdict was computed from", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const admin = freshAdmin();
    await generateAndPersistProductionVerdict(admin as never, { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID });
    const first = metricsOf(admin).verdictEvidence;
    (current.security_jobs as Array<Record<string, unknown>>)[0].status = "FAILED";
    await generateAndPersistProductionVerdict(admin as never, { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID });
    expect(metricsOf(admin).verdictEvidence).toEqual(first);
  });
});

describe("mergeScanMetrics: concurrent writers, silent errors", () => {
  it("another writer changing the row between our read and our write is not overwritten: it retries from the fresh row", async () => {
    const { mergeScanMetrics } = await import("../scan-metrics");
    const admin = freshAdmin();
    // A concurrent writer stores `late` right after our first read of the row.
    const original = admin.from.bind(admin);
    let interleaved = false;
    (admin as { from: unknown }).from = (table: string) => {
      const builder = original(table) as { select: (...a: unknown[]) => unknown; update: (...a: unknown[]) => unknown };
      if (table !== "scans") return builder;
      const update = builder.update.bind(builder);
      builder.update = (values: unknown) => {
        if (!interleaved) {
          interleaved = true;
          const row = scanOf(admin);
          row.metrics = { ...(row.metrics as object), late: "writer-2" };
          row.updated_at = "2026-10-13T13:04:31.999Z";
        }
        return update(values);
      };
      return builder;
    };
    const result = await mergeScanMetrics(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID, patch: { mine: 1 } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
    expect(metricsOf(admin)).toMatchObject({ mine: 1, late: "writer-2", rulesRun: 47 });
  });

  it("a database error is reported, not swallowed", async () => {
    const { mergeScanMetrics } = await import("../scan-metrics");
    const admin = freshAdmin();
    const original = admin.from.bind(admin);
    (admin as { from: unknown }).from = (table: string) => {
      const builder = original(table) as unknown as Record<string, unknown>;
      if (table !== "scans") return builder;
      builder.update = () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) }) }) });
      return builder;
    };
    const result = await mergeScanMetrics(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID, patch: { mine: 1 }, attempts: 2 });
    expect(result).toMatchObject({ ok: false, reason: "update_failed", message: "boom", attempts: 2 });
  });

  it("a missing scan is its own reason, and a no-op patch writes nothing", async () => {
    const { mergeScanMetrics } = await import("../scan-metrics");
    const admin = freshAdmin();
    expect(await mergeScanMetrics(admin as never, { scanId: "00000000-0000-4000-8000-000000000000", organizationId: ORG_ID, patch: { a: 1 } })).toMatchObject({ ok: false, reason: "scan_not_found" });
    const before = JSON.stringify(scanOf(admin));
    expect(await mergeScanMetrics(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID, patch: () => null })).toMatchObject({ ok: true });
    expect(JSON.stringify(scanOf(admin))).toBe(before);
  });

  it("key order does not decide whether a write 'took' (jsonb does not keep it)", async () => {
    const { mergeScanMetrics } = await import("../scan-metrics");
    const admin = freshAdmin();
    const result = await mergeScanMetrics(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID, patch: { nested: { b: 1, a: { d: 2, c: 3 } } } });
    expect(result.ok).toBe(true);
  });
});

describe("recordVerdictEvidenceSafely: a failure is visible and never breaks the verdict", () => {
  it("logs a structured warning when the write cannot be done and returns the failure", async () => {
    const { recordVerdictEvidenceSafely } = await import("../evidence-finalization");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const admin = freshAdmin();
    const original = admin.from.bind(admin);
    (admin as { from: unknown }).from = (table: string) => {
      const builder = original(table) as unknown as Record<string, unknown>;
      if (table !== "scans") return builder;
      builder.update = () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "denied" } }) }) }) }) }) });
      return builder;
    };
    const result = await recordVerdictEvidenceSafely(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID, mode: "pipeline", hasSecurityDecision: true });
    expect(result).toMatchObject({ recorded: false, reason: "write_failed" });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "verdict_evidence_record_failed", scanId: SCAN_ID }));
    warn.mockRestore();
  });
});
