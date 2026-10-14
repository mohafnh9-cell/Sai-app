import { readFileSync, readdirSync, statSync } from "node:fs";
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
    // the generator had its grace (the clock is past it) and never recorded: this is the cut-short case
    const clock = { now: () => Date.parse(generatedAt) + 11_000, sleep: async () => undefined };
    expect(await finalizeVerdictWhenEvidenceComplete(admin as never, { ...input, backfillEvidence: true, clock })).toEqual({ status: "already_exists" });
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

// 2026-10-14 T1: the evidence record of a real manual analysis was a "reconstruction" written 0.7 s after the verdict by a second
// finalization, not the generator's own capture. The generator inserts the verdict and records the evidence a few awaits later; a
// finalizer looking in between used to win. These tests pin the coordination down with a controllable clock (no real waiting).
describe("coordination between inserting the verdict and persisting its evidence (slow generator, concurrent finalizations)", () => {
  const T0 = Date.parse("2026-10-14T10:34:33.126Z");
  const input = { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID };
  const withVerdict = () => {
    const t = tables();
    t.production_verdicts = [{ id: "v1", organization_id: ORG_ID, scan_id: SCAN_ID, project_id: PROJECT_ID, generated_at: new Date(T0).toISOString() }];
    return t;
  };
  /** Fake time; `onTick(now)` runs on every sleep so a test can say "at +700 ms the generator writes its record". */
  const makeClock = (onTick: (now: number) => Promise<void> | void = () => undefined) => {
    let now = T0 + 100;
    const sleeps: number[] = [];
    return { sleeps, clock: { now: () => now, sleep: async (ms: number) => { sleeps.push(ms); now += ms; await onTick(now); } } };
  };
  const generatorRecords = async (admin: unknown) => {
    const { recordVerdictEvidence } = await import("../evidence-finalization");
    return recordVerdictEvidence(admin as never, { ...input, mode: "pipeline", hasSecurityDecision: true });
  };

  it("slow generator that finishes within the grace: the finalizer does NOT reconstruct; the record is the generator's capture", async () => {
    const { finalizeVerdictWhenEvidenceComplete } = await import("../evidence-finalization");
    const admin = freshAdmin(withVerdict());
    let recorded = false;
    const { clock, sleeps } = makeClock(async (now) => {
      if (!recorded && now >= T0 + 700) { recorded = true; await generatorRecords(admin); }
    });
    const outcome = await finalizeVerdictWhenEvidenceComplete(admin as never, { ...input, backfillEvidence: true, clock });
    expect(outcome).toEqual({ status: "already_exists" });
    expect(sleeps.length).toBeGreaterThan(0); // it did wait
    expect(metricsOf().verdictEvidence).toMatchObject({ capture: "at_verdict_generation" });
    expect((metricsOf().verdictEvidence as Record<string, unknown>).reconstructedAt).toBeUndefined();
  });

  it("generator cut short (never records): after the grace the finalizer reconstructs, labelled, and never waits past the grace", async () => {
    const { finalizeVerdictWhenEvidenceComplete, VERDICT_EVIDENCE_GENERATOR_GRACE_MS } = await import("../evidence-finalization");
    const admin = freshAdmin(withVerdict());
    const { clock, sleeps } = makeClock();
    await finalizeVerdictWhenEvidenceComplete(admin as never, { ...input, backfillEvidence: true, clock });
    expect(metricsOf().verdictEvidence).toMatchObject({ capture: "reconstructed_after_verdict" });
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(VERDICT_EVIDENCE_GENERATOR_GRACE_MS);
  });

  it("generator slower than the grace: the reconstruction stands (consistency comes from first-record-wins, not from the grace); the late generator write changes nothing", async () => {
    const { finalizeVerdictWhenEvidenceComplete } = await import("../evidence-finalization");
    const admin = freshAdmin(withVerdict());
    const { clock } = makeClock();
    await finalizeVerdictWhenEvidenceComplete(admin as never, { ...input, backfillEvidence: true, clock });
    const reconstruction = JSON.stringify(metricsOf().verdictEvidence);
    const late = await generatorRecords(admin);
    expect(late).toEqual({ recorded: true }); // a no-op reported as done: nothing to add
    expect(JSON.stringify(metricsOf().verdictEvidence)).toBe(reconstruction);
  });

  it("two concurrent finalizations of a verdict whose generator was cut short: exactly one record, no duplicate, no overwrite, other metrics intact", async () => {
    const { finalizeVerdictWhenEvidenceComplete } = await import("../evidence-finalization");
    const admin = freshAdmin(withVerdict());
    const a = makeClock(); const b = makeClock();
    const [first, second] = await Promise.all([
      finalizeVerdictWhenEvidenceComplete(admin as never, { ...input, backfillEvidence: true, clock: a.clock }),
      finalizeVerdictWhenEvidenceComplete(admin as never, { ...input, backfillEvidence: true, clock: b.clock }),
    ]);
    expect(first).toEqual({ status: "already_exists" });
    expect(second).toEqual({ status: "already_exists" });
    const record = metricsOf().verdictEvidence as Record<string, unknown>;
    expect(record.capture).toBe("reconstructed_after_verdict");
    expect(metricsOf()).toMatchObject({ rulesRun: 47, platformExecution: { stage: "done" }, verdictEvidenceReadyAt: "2026-10-13T13:04:31.222Z" });
    // the record is whichever writer won, intact: engines complete and one reconstructedAt
    expect(record.externalEngines).toHaveLength(3);
  });

  it("limit, stated rather than assumed: a reconstruction is NOT guaranteed identical to the generator's capture (it re-reads engines now and only sees a STORED security decision)", async () => {
    const { recordVerdictEvidence } = await import("../evidence-finalization");
    // the generator was handed the decision report directly (not stored in metrics); a reconstruction cannot know that
    const generated = freshAdmin();
    await recordVerdictEvidence(generated as never, { ...input, mode: "pipeline", hasSecurityDecision: true });
    const captured = metricsOf().verdictEvidence as Record<string, unknown>;
    const rebuilt = freshAdmin();
    await recordVerdictEvidence(rebuilt as never, { ...input, mode: "pipeline", hasSecurityDecision: false, reconstructedAfter: { verdictGeneratedAt: new Date(T0).toISOString() } });
    const reconstructed = metricsOf().verdictEvidence as Record<string, unknown>;
    expect(captured.securityDecisionIncluded).toBe(true);
    expect(reconstructed.securityDecisionIncluded).toBe(false);
    expect(captured.externalEngines).toEqual(reconstructed.externalEngines); // same engines when the jobs did not change in between
  });
});

// 2026-10-14 review: "first record wins" decides who writes, not WHAT the verdict was computed from. The generator now persists the
// snapshot of the evidence it read BEFORE publishing the verdict, and the verdict carries its digest, so the link is checkable.
describe("the evidence snapshot is persisted before the verdict is published and bound to it by a verifiable digest", () => {
  const input = { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID };
  const verdictRow = () => (current.production_verdicts as Array<Record<string, unknown>>)[0];
  const verdictJson = () => verdictRow()?.verdict as { evidenceDigest?: string; status?: string; score?: number; blockersCount?: number } | undefined;

  it("the record already exists when the verdict row is inserted, and checkEvidenceBinding verifies the pair", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const { checkEvidenceBinding, evidenceDigest } = await import("../evidence-snapshot");
    const admin = freshAdmin();
    // observe the instant of publication
    let recordAtInsert: unknown = "not observed";
    const original = admin.from.bind(admin);
    (admin as { from: unknown }).from = (table: string) => {
      const builder = original(table) as unknown as { insert: (...a: unknown[]) => unknown };
      if (table !== "production_verdicts") return builder;
      const insert = builder.insert.bind(builder);
      builder.insert = (...args: unknown[]) => { recordAtInsert = metricsOf().verdictEvidence; return insert(...args); };
      return builder;
    };
    await generateAndPersistProductionVerdict(admin as never, input);
    expect(recordAtInsert).toMatchObject({ capture: "at_verdict_generation" }); // persisted BEFORE publishing
    const record = metricsOf().verdictEvidence as { evidenceDigest: string; snapshot: Parameters<typeof evidenceDigest>[0] };
    expect(verdictJson()?.evidenceDigest).toBe(record.evidenceDigest);
    expect(evidenceDigest(record.snapshot)).toBe(record.evidenceDigest);
    expect(checkEvidenceBinding(verdictJson(), record)).toBe("verified_capture");
  });

  it("a concurrent finalizer never sees a verdict without its capture: it neither waits nor reconstructs", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const { finalizeVerdictWhenEvidenceComplete } = await import("../evidence-finalization");
    const { emitOperationalEvent } = await import("@/server/observability/operational-events");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (emitOperationalEvent as unknown as { mockImplementation: (f: (admin: unknown, e: { eventType: string }) => Promise<void>) => void }).mockImplementation(
      async (_admin, event) => { if (event.eventType === "verdict_created") await gate; } // generator held right after the insert
    );
    try {
      const admin = freshAdmin();
      const generating = generateAndPersistProductionVerdict(admin as never, input);
      for (let i = 0; i < 200 && (current.production_verdicts as unknown[]).length === 0; i++) await new Promise((r) => setTimeout(r, 0));
      expect((current.production_verdicts as unknown[]).length).toBe(1);
      const sleeps: number[] = [];
      const clock = { now: () => Date.now(), sleep: async (ms: number) => { sleeps.push(ms); } };
      expect(await finalizeVerdictWhenEvidenceComplete(admin as never, { ...input, backfillEvidence: true, clock })).toEqual({ status: "already_exists" });
      expect(sleeps).toEqual([]);
      expect(metricsOf().verdictEvidence).toMatchObject({ capture: "at_verdict_generation" });
      release();
      await generating;
      expect(metricsOf().verdictEvidence).toMatchObject({ capture: "at_verdict_generation" });
    } finally {
      (emitOperationalEvent as unknown as { mockImplementation: (f: () => Promise<void>) => void }).mockImplementation(async () => undefined);
    }
  });

  it("checkEvidenceBinding only vouches for a captured, matching pair; everything else is 'not traceable', never 'nothing found'", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const { checkEvidenceBinding } = await import("../evidence-snapshot");
    const admin = freshAdmin();
    await generateAndPersistProductionVerdict(admin as never, input);
    const record = JSON.parse(JSON.stringify(metricsOf().verdictEvidence)) as { snapshot: { externalEngines: Array<{ status: string }> } };
    expect(checkEvidenceBinding(verdictJson(), record)).toBe("verified_capture");
    const tampered = JSON.parse(JSON.stringify(record)); tampered.snapshot.externalEngines[0].status = "FAILED";
    expect(checkEvidenceBinding(verdictJson(), tampered)).toBe("digest_mismatch");
    expect(checkEvidenceBinding({ evidenceDigest: "a".repeat(64) }, record)).toBe("digest_mismatch"); // another snapshot's digest
    expect(checkEvidenceBinding({}, record)).toBe("verdict_without_digest");
    expect(checkEvidenceBinding(verdictJson(), { capture: "reconstructed_after_verdict" })).toBe("reconstruction_unverifiable");
    expect(checkEvidenceBinding(verdictJson(), undefined)).toBe("no_record");
  });

  it("if the snapshot cannot be persisted: the verdict is still published (same status, score, blockers) but WITHOUT a digest, and no record claims anything", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const baseline = freshAdmin();
    await generateAndPersistProductionVerdict(baseline as never, input);
    const expected = { status: verdictJson()?.status, score: verdictJson()?.score, blockersCount: verdictJson()?.blockersCount };

    const admin = freshAdmin();
    const original = admin.from.bind(admin);
    (admin as { from: unknown }).from = (table: string) => {
      const builder = original(table) as unknown as Record<string, unknown>;
      if (table !== "scans") return builder;
      // every filter is accepted; the final read-back reports the database error
      const failing: unknown = new Proxy({}, { get: (_t, prop) => (prop === "maybeSingle" ? async () => ({ data: null, error: { message: "boom" } }) : () => failing) });
      builder.update = () => failing;
      return builder;
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const verdict = await generateAndPersistProductionVerdict(admin as never, input);
      expect(verdict).not.toBeNull();
      expect({ status: verdictJson()?.status, score: verdictJson()?.score, blockersCount: verdictJson()?.blockersCount }).toEqual(expected); // a bookkeeping failure changes nothing about the verdict
      expect(verdictJson()?.evidenceDigest).toBeUndefined(); // no traceability claim it cannot back
      expect(metricsOf().verdictEvidence).toBeUndefined(); // and nothing recorded as "no engines" / "not_run"
      expect(warn.mock.calls.map((c) => (c[0] as { event?: string })?.event)).toContain("verdict_evidence_snapshot_not_persisted"); // visible, not silent
    } finally { warn.mockRestore(); }
  });

  it("a different snapshot already stands for the scan (another generator): this verdict carries no digest and the standing record is untouched", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const standing = { capture: "at_verdict_generation", evidenceDigest: "b".repeat(64), snapshot: { externalEngines: "not_run" }, finalizedBy: "pipeline" };
    const admin = freshAdmin(tables({ ...baseMetrics, verdictEvidence: standing }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await generateAndPersistProductionVerdict(admin as never, input);
      expect(verdictJson()?.evidenceDigest).toBeUndefined();
      expect(metricsOf().verdictEvidence).toEqual(standing);
    } finally { warn.mockRestore(); }
  });

  it("an unreadable external-findings table is not 'no findings': the verdict is computed as partial and the snapshot says 'unavailable'", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const admin = freshAdmin();
    const original = admin.from.bind(admin);
    (admin as { from: unknown }).from = (table: string) => {
      const builder = original(table) as unknown as Record<string, unknown>;
      if (table !== "external_engine_findings") return builder;
      builder.select = () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) });
      return builder;
    };
    await generateAndPersistProductionVerdict(admin as never, input);
    expect((metricsOf().verdictEvidence as { snapshot: { externalFindings: unknown } }).snapshot.externalFindings).toBe("unavailable");
    expect(verdictJson()?.status).not.toBe("ready_to_ship"); // evidence missing never reads as clean
  });
});

describe("digest determinism, what the snapshot identifies, failures between the two writes, and consumers", () => {
  const input = { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID };
  const verdictRow = () => (current.production_verdicts as Array<Record<string, unknown>>)[0];
  const verdictJson = () => verdictRow()?.verdict as Record<string, unknown> & { evidenceDigest?: string };
  const snap = async () => {
    const { digestIds } = await import("../evidence-snapshot");
    return {
      subject: { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID, commitSha: "abc123" },
      nativeFindings: { count: 2, idsDigest: digestIds(["n1", "n2"]) },
      externalEngines: [{ engine: "trivy", status: "COMPLETED" }, { engine: "crypto", status: "COMPLETED" }] as Array<{ engine: string; status: string }>,
      externalFindings: { count: 2, idsDigest: digestIds(["e1", "e2"]) },
      securityDecisionId: "d1" as string | null,
      securityDecisionIncluded: true,
    };
  };

  it("the digest is deterministic: independent of key order, engine order and id order; sensitive to every identifying field", async () => {
    const { evidenceDigest, digestIds } = await import("../evidence-snapshot");
    const a = await snap();
    const reordered = { securityDecisionIncluded: true, securityDecisionId: "d1", externalFindings: { idsDigest: digestIds(["e2", "e1", "e1"]), count: 2 }, externalEngines: [...a.externalEngines].reverse(),
      nativeFindings: { idsDigest: digestIds(["n2", "n1"]), count: 2 }, subject: { commitSha: "abc123", scanId: SCAN_ID, projectId: PROJECT_ID, organizationId: ORG_ID } };
    expect(evidenceDigest(reordered)).toBe(evidenceDigest(a));
    expect(evidenceDigest(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(evidenceDigest(a)).toBe(evidenceDigest(JSON.parse(JSON.stringify(a)))); // survives a JSON round trip (jsonb)
    const variants = [
      { ...a, subject: { ...a.subject, organizationId: "other" } }, { ...a, subject: { ...a.subject, projectId: "other" } },
      { ...a, subject: { ...a.subject, scanId: "other" } }, { ...a, subject: { ...a.subject, commitSha: "def456" } },
      { ...a, externalEngines: [{ engine: "trivy", status: "FAILED" }, a.externalEngines[1]!] }, { ...a, externalEngines: "not_run" as const },
      { ...a, externalFindings: "unavailable" as const }, { ...a, nativeFindings: { count: 2, idsDigest: digestIds(["n1", "n3"]) } },
      { ...a, securityDecisionId: null, securityDecisionIncluded: false },
    ];
    for (const v of variants) expect(evidenceDigest(v)).not.toBe(evidenceDigest(a));
    expect(new Set(variants.map((v) => evidenceDigest(v))).size).toBe(variants.length);
  });

  it("the stored snapshot identifies organization, project, scan, commit, engines and the evidence used", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const admin = freshAdmin();
    await generateAndPersistProductionVerdict(admin as never, input);
    const record = metricsOf().verdictEvidence as { snapshot: Record<string, unknown> };
    expect(record.snapshot).toMatchObject({
      subject: { organizationId: ORG_ID, projectId: PROJECT_ID, scanId: SCAN_ID, commitSha: "abc123" },
      nativeFindings: { count: expect.any(Number), idsDigest: expect.stringMatching(/^[0-9a-f]{64}$/) },
      externalEngines: [{ engine: "opengrep", status: "COMPLETED" }, { engine: "trivy", status: "COMPLETED" }, { engine: "crypto", status: "COMPLETED" }],
      externalFindings: { count: 0 },
    });
  });

  it("a snapshot moved to another scan (self-consistent but about something else) is not verified", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const { checkEvidenceBinding, evidenceDigest } = await import("../evidence-snapshot");
    const admin = freshAdmin();
    await generateAndPersistProductionVerdict(admin as never, input);
    const record = JSON.parse(JSON.stringify(metricsOf().verdictEvidence)) as { evidenceDigest: string; snapshot: { subject: { scanId: string } } };
    expect(checkEvidenceBinding(verdictJson(), record)).toBe("verified_capture");
    record.snapshot.subject.scanId = "99999999-9999-4999-8999-999999999999";
    record.evidenceDigest = evidenceDigest(record.snapshot as never); // forged to be self-consistent
    expect(checkEvidenceBinding({ ...verdictJson(), evidenceDigest: record.evidenceDigest }, record)).toBe("digest_mismatch"); // the verdict is about SCAN_ID
  });

  it("failure BETWEEN the two writes (snapshot stored, verdict insert fails): the retry with the same inputs binds; with changed inputs it is published without a digest and never verified", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const { checkEvidenceBinding } = await import("../evidence-snapshot");
    const admin = freshAdmin();
    const original = admin.from.bind(admin);
    let failInsert = true;
    (admin as { from: unknown }).from = (table: string) => {
      const builder = original(table) as unknown as { insert: (...a: unknown[]) => unknown };
      if (table !== "production_verdicts") return builder;
      const insert = builder.insert.bind(builder);
      builder.insert = (...args: unknown[]) => (failInsert ? { select: () => ({ single: async () => ({ data: null, error: { message: "insert boom" } }) }) } : insert(...args));
      return builder;
    };
    await expect(generateAndPersistProductionVerdict(admin as never, input)).rejects.toThrow();
    expect(current.production_verdicts).toHaveLength(0); // nothing published
    const orphan = metricsOf().verdictEvidence as { capture: string };
    expect(orphan.capture).toBe("at_verdict_generation"); // the snapshot is there, but no verdict claims it

    failInsert = false;
    await generateAndPersistProductionVerdict(admin as never, input); // same evidence: same digest -> the standing snapshot is this verdict's
    expect(checkEvidenceBinding(verdictJson(), metricsOf().verdictEvidence)).toBe("verified_capture");

    // changed inputs between the writes: a different snapshot stands, so the verdict must not vouch for it
    const t = freshAdmin();
    const orig2 = t.from.bind(t);
    let fail2 = true;
    (t as { from: unknown }).from = (table: string) => {
      const builder = orig2(table) as unknown as { insert: (...a: unknown[]) => unknown };
      if (table !== "production_verdicts") return builder;
      const insert = builder.insert.bind(builder);
      builder.insert = (...args: unknown[]) => (fail2 ? { select: () => ({ single: async () => ({ data: null, error: { message: "insert boom" } }) }) } : insert(...args));
      return builder;
    };
    await expect(generateAndPersistProductionVerdict(t as never, input)).rejects.toThrow();
    (current.security_jobs as Array<Record<string, unknown>>)[1].status = "FAILED"; // an engine result changed in between
    fail2 = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await generateAndPersistProductionVerdict(t as never, input);
      expect(verdictJson().evidenceDigest).toBeUndefined();
      expect(checkEvidenceBinding(verdictJson(), metricsOf().verdictEvidence)).not.toBe("verified_capture");
    } finally { warn.mockRestore(); }
  });

  it("nothing but a captured, matching pair is ever 'verified_capture' (reconstruction, no digest, edited snapshot, edited digest, no record)", async () => {
    const { generateAndPersistProductionVerdict } = await import("../core");
    const { checkEvidenceBinding } = await import("../evidence-snapshot");
    const admin = freshAdmin();
    await generateAndPersistProductionVerdict(admin as never, input);
    const good = JSON.parse(JSON.stringify(metricsOf().verdictEvidence)) as Record<string, unknown> & { snapshot: { securityDecisionIncluded: boolean } };
    const verdict = verdictJson();
    const attempts: Array<[string, unknown, ReturnType<typeof checkEvidenceBinding>]> = [
      ["reconstruction", { ...good, capture: "reconstructed_after_verdict" }, "reconstruction_unverifiable"],
      ["edited snapshot", { ...good, snapshot: { ...good.snapshot, securityDecisionIncluded: !good.snapshot.securityDecisionIncluded } }, "digest_mismatch"],
      ["edited digest", { ...good, evidenceDigest: "c".repeat(64) }, "digest_mismatch"],
      ["no snapshot", { capture: "at_verdict_generation", evidenceDigest: good.evidenceDigest }, "digest_mismatch"],
      ["no record", null, "no_record"],
    ];
    for (const [, record, expected] of attempts) expect(checkEvidenceBinding(verdict as never, record)).toBe(expected);
    expect(checkEvidenceBinding({ ...(verdict as object), evidenceDigest: undefined } as never, good)).toBe("verdict_without_digest");
  });

  it("consumers never read the evidence fields directly: only the evidence modules and the schema touch verdictEvidence/evidenceDigest (everything else must go through checkEvidenceBinding)", () => {
    const allowed = new Set([
      "server/production-verdict/evidence-finalization.ts", "server/production-verdict/evidence-snapshot.ts", "server/production-verdict/core.ts",
      "brain/production-verdict/schema.ts",
    ]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (name === "node_modules" || name === ".next" || name === "__tests__") continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && /verdictEvidence\b|evidenceDigest/.test(readFileSync(path, "utf8")) && !allowed.has(path)) hits.push(path);
      }
    };
    for (const dir of ["app", "server", "lib", "features", "brain", "components", "inngest", "mcp"]) { try { walk(dir); } catch { /* absent */ } }
    expect(hits).toEqual([]);
  });
});
