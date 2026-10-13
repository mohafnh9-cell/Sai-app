import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/observability/operational-events", () => ({ emitOperationalEvent: vi.fn(async () => undefined) }));
vi.mock("@/server/observability/metrics", () => ({ incrementMetricCounter: vi.fn(), percentileSummary: vi.fn(() => ({})) }));
vi.mock("@/server/observability/health-summary", () => ({ buildJobsHealthSummary: vi.fn(async () => ({})) }));
vi.mock("@/server/observability/alert-routing", () => ({
  evaluateOperationalAlerts: vi.fn(() => ({ alerts: [] })),
  emitOperationalAlerts: vi.fn(async () => undefined),
  fetchAlertWindowMetrics: vi.fn(async () => ({})),
}));
vi.mock("@/server/review-recovery/stale-review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/review-recovery/stale-review")>()),
  expireStaleActiveReviewsForRepository: vi.fn(async () => 0),
}));

const calls = vi.hoisted(() => ({ generated: [] as string[], tables: null as null | Record<string, Array<Record<string, unknown>>> }));
// The canonical generator is replaced by a recorder that persists a verdict row (like the real one, one per scan).
vi.mock("@/server/production-verdict/core", () => ({
  generateAndPersistProductionVerdict: vi.fn(async (_admin: unknown, input: { scanId: string }) => {
    calls.generated.push(input.scanId);
    const existing = calls.tables?.production_verdicts.find((row) => row.scan_id === input.scanId);
    if (!existing) calls.tables?.production_verdicts.push({ id: `v-${input.scanId}`, scan_id: input.scanId, organization_id: "org-a", status: "insufficient_data" });
    return { scanId: input.scanId, status: "insufficient_data" };
  }),
}));

import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { runScanJobRecovery } from "../recovery";
import { findJobsNeedingFinalize } from "../scan-job-store";
import { EVIDENCE_READY_KEY, finalizeVerdictWhenEvidenceComplete, recoverDeferredVerdicts } from "@/server/production-verdict/evidence-finalization";
import { transitionSecurityJob } from "@/server/security-jobs/service";

// Reproduces D9 deterministically (see docs/INVESTIGATION_MANUAL_VS_AUTOMATIC_VERDICT_2026-10-13.md):
//   scan `completed` + scan job still `running` + engines/evidence pending
//   -> a READ (Mission Control / Journey / status poll) used to complete the job and settle the (immutable) verdict early.
// Time is frozen; every row is explicit. What is REPRODUCED here is the mechanism in code; what was INFERRED about the 2026-10-10
// executions (that it was a UI read) is documented separately and still needs the runtime logs.

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const SCAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.parse("2026-10-10T07:13:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const MIN = 60_000;

type Engine = { id: string; engine: string; status: string; requestedAgoMs?: number; startedAgoMs?: number | null; timeoutMs?: number };
type Opts = { scanJob?: Record<string, unknown> | null; engines?: Engine[]; marker?: boolean; jobType?: string; verdict?: boolean };

function world(opts: Opts = {}) {
  const tables = {
    projects: [{ id: PROJECT, organization_id: ORG, github_default_branch: "main" }],
    scans: [{ id: SCAN, organization_id: ORG, project_id: PROJECT, repository_id: PROJECT, status: "completed", branch: "main", commit_sha: "c".repeat(40),
      created_at: iso(-30_000), started_at: iso(-25_000), completed_at: iso(-7_000), updated_at: iso(-7_000), queued_at: iso(-30_000),
      metrics: opts.marker ? { [EVIDENCE_READY_KEY]: iso(-2_000) } : {} }],
    scan_jobs: opts.scanJob === null ? [] : [{
      id: JOB, organization_id: ORG, project_id: PROJECT, scan_id: SCAN, job_type: opts.jobType ?? "manual_scan", status: "running",
      scheduled_at: iso(-30_000), started_at: iso(-25_000), heartbeat_at: iso(-8_000), updated_at: iso(-8_000), created_at: iso(-30_000),
      execution_deadline_at: iso(10 * MIN), metadata: {}, ...opts.scanJob,
    }],
    security_jobs: (opts.engines ?? []).map((e) => ({
      id: e.id, scan_id: SCAN, organization_id: ORG, project_id: PROJECT, engine: e.engine, status: e.status,
      requested_at: iso(-(e.requestedAgoMs ?? 5_000)), started_at: e.startedAgoMs === null ? null : iso(-(e.startedAgoMs ?? 3_000)), timeout_ms: e.timeoutMs ?? 5 * MIN,
    })),
    production_verdicts: opts.verdict ? [{ id: "v-existing", scan_id: SCAN, organization_id: ORG }] : [],
    repository_scan_state: [{ repository_id: PROJECT, organization_id: ORG, active_scan_id: null, last_scan_id: SCAN }],
    scan_job_events: [],
  } as unknown as FakeTables;
  calls.tables = tables as never;
  calls.generated = [];
  return { tables, admin: createFakeAdmin(tables) as never };
}

const readState = (admin: never) => getProductionReviewState(admin, { organizationId: ORG, projectId: PROJECT });
const jobRow = (tables: FakeTables) => tables.scan_jobs![0];
const engineStatuses = (tables: FakeTables) => Object.fromEntries((tables.security_jobs ?? []).map((j) => [j.engine as string, j.status as string]));

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("D9: a READ must not complete a live job or settle its verdict", () => {
  it("REPRODUCTION: scan completed, job running with a fresh heartbeat, engines running/queued -> reads change NOTHING", async () => {
    const { tables, admin } = world({ engines: [{ id: "e1", engine: "opengrep", status: "RUNNING" }, { id: "e2", engine: "trivy", status: "QUEUED" }] });
    // Mission Control and Journey polling, several readers at once.
    await Promise.all([readState(admin), readState(admin), readState(admin), readState(admin)]);
    expect(jobRow(tables).status).toBe("running"); // not completed by a reader
    expect(calls.generated).toEqual([]); // no verdict settled early
    expect(tables.production_verdicts).toHaveLength(0);
    expect(engineStatuses(tables)).toEqual({ opengrep: "RUNNING", trivy: "QUEUED" }); // engines untouched
  });

  it("the same for a scan whose engine jobs do not exist YET (the runner is about to create them)", async () => {
    const { tables, admin } = world({ engines: [] });
    await readState(admin);
    expect(jobRow(tables).status).toBe("running");
    expect(calls.generated).toEqual([]);
  });

  it("a job with a recent trace but a stale heartbeat is still alive (any fresh signal counts)", async () => {
    const { tables, admin } = world({ scanJob: { heartbeat_at: iso(-20 * MIN), updated_at: iso(-20 * MIN), metadata: { lastTraceAt: iso(-5_000) } }, engines: [{ id: "e1", engine: "trivy", status: "RUNNING" }] });
    await readState(admin);
    expect(jobRow(tables).status).toBe("running");
    expect(calls.generated).toEqual([]);
  });

  it("the recovery cron's finalize candidates exclude a live job", async () => {
    const { admin } = world({ engines: [{ id: "e1", engine: "trivy", status: "RUNNING" }] });
    expect(await findJobsNeedingFinalize(admin)).toEqual([]);
  });
});

describe("recovery stays possible for jobs that are REALLY abandoned", () => {
  const abandoned = { heartbeat_at: iso(-10 * MIN), started_at: iso(-12 * MIN), updated_at: iso(-10 * MIN) };

  it("abandoned job + every engine terminal -> verdict generated once from the evidence that exists, job completed", async () => {
    const { tables, admin } = world({ scanJob: abandoned, marker: false, engines: [{ id: "e1", engine: "opengrep", status: "COMPLETED" }, { id: "e2", engine: "trivy", status: "FAILED" }] });
    await Promise.all([readState(admin), readState(admin)]);
    expect(jobRow(tables).status).toBe("completed");
    expect(calls.generated).toEqual([SCAN]); // exactly once even with concurrent readers
    expect(engineStatuses(tables)).toEqual({ opengrep: "COMPLETED", trivy: "FAILED" }); // a failure stays a failure
    const evidence = (tables.scans![0].metrics as { verdictEvidence?: { externalEngines: Array<{ engine: string; status: string }>; finalizedBy: string } }).verdictEvidence;
    expect(evidence?.finalizedBy).toBe("recovery");
    expect(evidence?.externalEngines).toEqual([{ engine: "opengrep", status: "COMPLETED" }, { engine: "trivy", status: "FAILED" }]);
  });

  it("abandoned job but a live engine still inside its budget -> nothing is settled yet, the job is left for the next pass", async () => {
    const { tables, admin } = world({ scanJob: abandoned, engines: [{ id: "e1", engine: "trivy", status: "RUNNING", startedAgoMs: 30_000, timeoutMs: 5 * MIN }] });
    await readState(admin);
    expect(jobRow(tables).status).toBe("running");
    expect(calls.generated).toEqual([]);
    expect(engineStatuses(tables)).toEqual({ trivy: "RUNNING" });
  });

  it("SLOW ENGINE that outlived its own timeout (+ grace): terminalized as TIMED_OUT / REJECTED -- never as success -- then the verdict is generated", async () => {
    const { tables, admin } = world({
      scanJob: abandoned,
      engines: [
        { id: "e1", engine: "trivy", status: "RUNNING", startedAgoMs: 9 * MIN, timeoutMs: 5 * MIN },
        { id: "e2", engine: "crypto", status: "QUEUED", requestedAgoMs: 9 * MIN, startedAgoMs: null, timeoutMs: 5 * MIN },
        { id: "e3", engine: "opengrep", status: "COMPLETED" },
      ],
    });
    await readState(admin);
    expect(engineStatuses(tables)).toEqual({ trivy: "TIMED_OUT", crypto: "REJECTED", opengrep: "COMPLETED" });
    expect(tables.security_jobs!.find((j) => j.engine === "trivy")!.error).toMatchObject({ code: "abandoned_timeout" });
    expect(tables.security_jobs!.find((j) => j.engine === "crypto")!.error).toMatchObject({ code: "queue_expired" });
    expect(jobRow(tables).status).toBe("completed");
    expect(calls.generated).toEqual([SCAN]);
  });

  it("an abandoned job whose scan has a verdict already is simply closed (the verdict is never regenerated)", async () => {
    const { tables, admin } = world({ scanJob: abandoned, verdict: true, engines: [{ id: "e1", engine: "trivy", status: "COMPLETED" }] });
    await readState(admin);
    expect(jobRow(tables).status).toBe("completed");
    expect(calls.generated).toEqual([]);
    expect(tables.production_verdicts).toHaveLength(1);
  });

  it("automatic reviews never get a recovery verdict from a read (they have their own finalization)", async () => {
    const { tables, admin } = world({ jobType: "automatic_review", scanJob: abandoned, engines: [] });
    await readState(admin);
    expect(calls.generated).toEqual([]);
    expect(jobRow(tables).status).toBe("completed");
  });
});

describe("normal finalization is untouched and a failure is explicit", () => {
  it("slow engine: no verdict until the LAST engine is terminal, then exactly one", async () => {
    const { tables, admin } = world({ marker: true, engines: [{ id: "e1", engine: "opengrep", status: "COMPLETED" }, { id: "e2", engine: "trivy", status: "RUNNING" }] });
    const input = { organizationId: ORG, projectId: PROJECT, scanId: SCAN };
    expect(await finalizeVerdictWhenEvidenceComplete(admin, input)).toMatchObject({ status: "deferred", reason: "engines_pending", pendingEngines: ["trivy"] });
    expect(calls.generated).toEqual([]);
    await transitionSecurityJob(admin, { jobId: "e2", from: "RUNNING", to: "COMPLETED" }); // the engine finishes; its hook finalizes
    expect(calls.generated).toEqual([SCAN]);
    expect(tables.production_verdicts).toHaveLength(1);
  });

  it("an engine that FAILS makes the evidence ready (terminal) and stays visible as FAILED in the recorded evidence", async () => {
    const { tables, admin } = world({ marker: true, engines: [{ id: "e1", engine: "trivy", status: "RUNNING" }] });
    await transitionSecurityJob(admin, { jobId: "e1", from: "RUNNING", to: "FAILED", error: { code: "engine_crashed", message: "boom" } });
    expect(calls.generated).toEqual([SCAN]);
    const evidence = (tables.scans![0].metrics as { verdictEvidence?: { externalEngines: unknown } }).verdictEvidence;
    expect(evidence?.externalEngines).toEqual([{ engine: "trivy", status: "FAILED" }]);
  });

  it("concurrent finalizers (normal path + recovery) end with ONE verdict", async () => {
    const { tables, admin } = world({ marker: true, engines: [{ id: "e1", engine: "trivy", status: "COMPLETED" }] });
    const input = { organizationId: ORG, projectId: PROJECT, scanId: SCAN };
    // The generator is injected: vitest cannot resolve a mocked module for several simultaneous dynamic imports.
    const { generateAndPersistProductionVerdict } = await import("@/server/production-verdict/core");
    const generate = generateAndPersistProductionVerdict as never;
    await Promise.all([
      finalizeVerdictWhenEvidenceComplete(admin, { ...input, mode: "pipeline", generate }),
      finalizeVerdictWhenEvidenceComplete(admin, { ...input, mode: "recovery", generate }),
      finalizeVerdictWhenEvidenceComplete(admin, { ...input, mode: "pipeline", generate }),
    ]);
    expect(tables.production_verdicts).toHaveLength(1);
  });

  it("the evidence record documents a scan with NO external engines as not run (it is not equivalent to a full analysis)", async () => {
    const { tables, admin } = world({ marker: true, engines: [] });
    await finalizeVerdictWhenEvidenceComplete(admin, { organizationId: ORG, projectId: PROJECT, scanId: SCAN });
    expect((tables.scans![0].metrics as { verdictEvidence?: { externalEngines: unknown } }).verdictEvidence?.externalEngines).toBe("not_run");
  });
});

describe("finalization requested by another reader (e.g. the MCP self-heal) while the job is still creating its engines", () => {
  const input = { organizationId: ORG, projectId: PROJECT, scanId: SCAN };

  it("no engine job exists yet and the scan job is alive -> deferred, nothing generated", async () => {
    const { admin } = world({ engines: [] });
    expect(await finalizeVerdictWhenEvidenceComplete(admin, input)).toMatchObject({ status: "deferred", reason: "evidence_not_ready" });
    expect(calls.generated).toEqual([]);
  });

  it("the same scan once its job is gone (no live scan job) is finalized from what exists", async () => {
    const { admin } = world({ engines: [], scanJob: null });
    expect((await finalizeVerdictWhenEvidenceComplete(admin, input)).status).toBe("generated");
  });
});

describe("deferred verdicts do not wait forever", () => {
  it("a completed scan older than 5 minutes without a verdict is finalized by the cron once its engines are terminal or abandoned", async () => {
    const { tables, admin } = world({ marker: true, scanJob: null, engines: [{ id: "e1", engine: "trivy", status: "RUNNING", startedAgoMs: 20 * MIN, timeoutMs: 5 * MIN }] });
    tables.scans![0].completed_at = iso(-10 * MIN);
    const result = await recoverDeferredVerdicts(admin, { nowMs: NOW });
    expect(result).toEqual({ examined: 1, generated: 1, deferred: 0 });
    expect(engineStatuses(tables)).toEqual({ trivy: "TIMED_OUT" });
  });

  it("a scan that completed seconds ago is not touched by the cron", async () => {
    const { tables, admin } = world({ marker: true, engines: [{ id: "e1", engine: "trivy", status: "RUNNING" }] });
    expect(await recoverDeferredVerdicts(admin, { nowMs: NOW })).toEqual({ examined: 0, generated: 0, deferred: 0 });
    expect(tables.production_verdicts).toHaveLength(0);
  });

  it("the full recovery pass runs it and reports it, without throwing", async () => {
    const { admin } = world({ marker: true, scanJob: null, engines: [] });
    await expect(runScanJobRecovery(admin)).resolves.toBeDefined();
  });
});
