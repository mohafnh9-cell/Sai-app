import { readFileSync } from "node:fs";
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

describe("the record does not depend on what runs AFTER the verdict", () => {
  it("is already stored when the slow post-verdict steps (AI reasoning, memory) start, and survives them failing or never finishing", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const reasoning = await import("@/server/ai-reasoning/run-scan-reasoning");
    const admin = freshAdmin();
    let storedWhenReasoningStarted: unknown = "not called";
    vi.mocked(reasoning.runScanAiReasoning).mockImplementationOnce(async () => {
      storedWhenReasoningStarted = (scanOf().metrics as Record<string, unknown>).verdictEvidence;
      throw new Error("function cut short after the verdict");
    });
    await generateAndPersistProductionVerdict(admin as never, { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID });
    expect(storedWhenReasoningStarted).toMatchObject({ finalizedBy: "pipeline" });
  });
});

describe("conflicts and exhausted retries", () => {
  const withConstantlyChangingRow = (admin: ReturnType<typeof createFakeAdmin>) => {
    const original = admin.from.bind(admin);
    let bump = 0;
    (admin as { from: unknown }).from = (table: string) => {
      const builder = original(table) as unknown as { update: (v: unknown) => unknown };
      if (table !== "scans") return builder;
      const update = builder.update.bind(builder);
      builder.update = (values: unknown) => {
        // another writer lands between EVERY read and write
        bump += 1;
        const row = scanOf();
        row.metrics = { ...(row.metrics as object), [`other${bump}`]: bump };
        row.updated_at = `2026-10-13T13:05:${String(bump).padStart(2, "0")}.000Z`;
        return update(values);
      };
      return builder;
    };
  };

  it("never overwrites the other writer's keys, writes nothing of ours, and reports the exhaustion", async () => {
    const { mergeScanMetrics } = await import("../scan-metrics");
    const admin = freshAdmin();
    withConstantlyChangingRow(admin);
    const result = await mergeScanMetrics(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID, patch: { mine: 1 }, attempts: 3 });
    expect(result).toEqual({ ok: false, reason: "conflict_exhausted", attempts: 3, message: undefined });
    const metrics = metricsOf();
    expect(metrics.mine).toBeUndefined();               // nothing half-written
    expect(metrics).toMatchObject({ other1: 1, other2: 2, other3: 3, rulesRun: 47 }); // everything the others stored is intact
  });

  it("the verdict evidence record reports the failure (recorded:false) instead of claiming success", async () => {
    const { recordVerdictEvidence } = await import("../evidence-finalization");
    const admin = freshAdmin();
    withConstantlyChangingRow(admin);
    const result = await recordVerdictEvidence(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID, mode: "pipeline", hasSecurityDecision: false });
    expect(result).toMatchObject({ recorded: false, reason: "write_failed" });
    expect(metricsOf().verdictEvidence).toBeUndefined();
  });

  it("the evidence marker (read by the verdict) fails loudly instead of pretending it was stored", async () => {
    const { markVerdictEvidenceReady } = await import("../evidence-finalization");
    const admin = freshAdmin();
    withConstantlyChangingRow(admin);
    await expect(markVerdictEvidenceReady(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID })).rejects.toThrow(/Could not mark verdict evidence ready/);
  });

  it("every successful write changes updated_at (the condition other writers rely on)", async () => {
    const { mergeScanMetrics } = await import("../scan-metrics");
    // In production the BEFORE UPDATE trigger public.set_updated_at() sets updated_at = now() on every update (microsecond
    // resolution); the in-memory admin mimics it with millisecond resolution, so the clock is moved between the two writes.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-13T13:10:00.000Z"));
      const admin = freshAdmin();
      const before = scanOf().updated_at;
      await mergeScanMetrics(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID, patch: { a: 1 } });
      const afterFirst = scanOf().updated_at;
      vi.setSystemTime(new Date("2026-10-13T13:10:01.000Z"));
      await mergeScanMetrics(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID, patch: { b: 2 } });
      expect(afterFirst).not.toBe(before);
      expect(scanOf().updated_at).not.toBe(afterFirst);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the platform summary writer uses the same conditional mechanism and keeps other keys", () => {
  it("adds platformExecution without dropping the evidence marker or the record", async () => {
    const { attachPlatformSummaryToScan } = await import("@/server/platform-convergence/persist-scan-platform");
    const admin = freshAdmin(tables({ ...baseMetrics, verdictEvidence: { finalizedBy: "pipeline" } }));
    await attachPlatformSummaryToScan(admin as never, {
      scanId: SCAN_ID, organizationId: ORG_ID,
      platform: { ids: { correlationId: "c", executionId: "e", decisionId: "d" }, pipelineStatus: "completed", completedAt: 5 } as never,
    });
    expect(metricsOf()).toMatchObject({ platformExecution: { correlationId: "c", pipelineStatus: "completed" }, verdictEvidence: { finalizedBy: "pipeline" }, verdictEvidenceReadyAt: "2026-10-13T13:04:31.222Z", rulesRun: 47 });
  });
});

describe("late completion of the evidence record: opt-in, labelled as a reconstruction, never over existing evidence, never historical", () => {
  const base = (generatedAt: string, metrics: Record<string, unknown> = baseMetrics) => {
    const t = tables(metrics);
    t.production_verdicts = [{ id: "v1", organization_id: ORG_ID, scan_id: SCAN_ID, project_id: PROJECT_ID, generated_at: generatedAt }];
    return t;
  };
  const input = { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID };

  it("normal finalization (backfillEvidence:true), recent verdict, no record: completed AND labelled as reconstructed (not as captured at generation)", async () => {
    const { finalizeVerdictWhenEvidenceComplete } = await import("../evidence-finalization");
    const generatedAt = new Date().toISOString();
    const admin = freshAdmin(base(generatedAt));
    expect(await finalizeVerdictWhenEvidenceComplete(admin as never, { ...input, backfillEvidence: true })).toEqual({ status: "already_exists" });
    const record = metricsOf().verdictEvidence as Record<string, unknown>;
    expect(record).toMatchObject({ capture: "reconstructed_after_verdict", verdictGeneratedAt: generatedAt, externalEngines: expect.any(Array) });
    expect(record.reconstructedAt).toEqual(expect.any(String));
    expect(record.finalizedAt).toBeUndefined(); // it does not claim to be the moment the verdict was generated
  });

  it("a record captured at generation says so", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const admin = freshAdmin();
    await generateAndPersistProductionVerdict(admin as never, { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID });
    expect(metricsOf().verdictEvidence).toMatchObject({ capture: "at_verdict_generation", finalizedAt: expect.any(String) });
  });

  it("default (readers: HTTP GET, MCP read tools, the review-state read): NOTHING is written to the scan", async () => {
    const { finalizeVerdictWhenEvidenceComplete } = await import("../evidence-finalization");
    const admin = freshAdmin(base(new Date().toISOString()));
    const before = JSON.stringify(scanOf());
    expect(await finalizeVerdictWhenEvidenceComplete(admin as never, input)).toEqual({ status: "already_exists" });
    expect(JSON.stringify(scanOf())).toBe(before);
  });

  it("existing evidence is never overwritten, not even with the opt-in", async () => {
    const { finalizeVerdictWhenEvidenceComplete } = await import("../evidence-finalization");
    const existing = { capture: "at_verdict_generation", finalizedAt: "2026-10-13T13:04:41.300Z", finalizedBy: "pipeline", externalEngines: [{ engine: "trivy", status: "COMPLETED" }] };
    const admin = freshAdmin(base(new Date().toISOString(), { ...baseMetrics, verdictEvidence: existing }));
    await finalizeVerdictWhenEvidenceComplete(admin as never, { ...input, backfillEvidence: true });
    expect(metricsOf().verdictEvidence).toEqual(existing);
  });

  it("an old verdict is left exactly as it is, even with the opt-in", async () => {
    const { finalizeVerdictWhenEvidenceComplete } = await import("../evidence-finalization");
    const admin = freshAdmin(base(new Date(Date.now() - 3 * 24 * 3_600_000).toISOString()));
    const before = JSON.stringify(scanOf());
    await finalizeVerdictWhenEvidenceComplete(admin as never, { ...input, backfillEvidence: true });
    expect(JSON.stringify(scanOf())).toBe(before);
  });

  it("which callers opt in is fixed in the source: only the runner's wait and the engine-terminal hook; no read path", () => {
    const read = (p: string) => readFileSync(p, "utf8");
    const finalization = read("server/production-verdict/evidence-finalization.ts");
    expect((finalization.match(/backfillEvidence: true/g) ?? []).length).toBe(2);
    for (const reader of ["server/mcp/canonical-decision-state.ts", "server/production-verdict/ensure-verdict-for-scan.ts", "server/jobs/reconcile-orphan-scan-job.ts"]) {
      expect(read(reader)).not.toContain("backfillEvidence");
    }
  });
});

describe("evidence writers only write on a completed scan (the status is locked by the database trigger)", () => {
  it("the marker and the record refuse to write while the scan is still active, and write nothing", async () => {
    const { mergeScanMetrics } = await import("../scan-metrics");
    const { markVerdictEvidenceReady, recordVerdictEvidence } = await import("../evidence-finalization");
    const t = tables();
    (t.scans as Array<Record<string, unknown>>)[0].status = "scanning";
    const admin = freshAdmin(t);
    const before = JSON.stringify(scanOf());
    await expect(markVerdictEvidenceReady(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID })).rejects.toThrow(/status_not_allowed/);
    expect(await recordVerdictEvidence(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID, mode: "pipeline", hasSecurityDecision: false })).toMatchObject({ recorded: false });
    expect(await mergeScanMetrics(admin as never, { scanId: SCAN_ID, organizationId: ORG_ID, patch: { x: 1 }, requireStatus: ["completed"] })).toMatchObject({ ok: false, reason: "status_not_allowed" });
    expect(JSON.stringify(scanOf())).toBe(before);
  });
});
