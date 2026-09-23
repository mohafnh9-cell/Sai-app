import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls = vi.hoisted(() => ({
  log: [] as string[],
  tables: null as null | Record<string, Array<Record<string, unknown>>>,
}));

// The canonical generator is replaced by a recorder that persists a verdict row.
vi.mock("../core", () => ({
  generateAndPersistProductionVerdict: vi.fn(
    async (_admin: unknown, input: { scanId: string; securityDecisionReport?: unknown }) => {
      calls.log.push(`generate:${input.scanId}`);
      calls.tables?.production_verdicts.push({ id: `v-${input.scanId}`, scan_id: input.scanId, organization_id: "org-a" });
      return { scanId: input.scanId, status: "insufficient_data", decision: input.securityDecisionReport ?? null };
    }
  ),
}));

import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { hasIncompleteExternalEngineCoverage } from "@/server/security-orchestrator/verdict-integration";
import { transitionSecurityJob } from "@/server/security-jobs/service";
import { generateAndPersistProductionVerdict } from "../core";
import { ensureProductionVerdictForCompletedScan } from "../ensure-verdict-for-scan";
import {
  EVIDENCE_READY_KEY,
  finalizeVerdictWhenEvidenceComplete,
  markVerdictEvidenceReady,
  waitForScanVerdict,
} from "../evidence-finalization";

// Pass 4 HIGH-005: the verdict for a scan is generated once, and only after
// every engine job for that scan has reached a terminal state.

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const SCAN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCAN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type JobSeed = { id: string; scan: string; engine: string; status: string };

function world(jobs: JobSeed[], opts: { ready?: boolean; scanStatus?: string; scans?: string[] } = {}) {
  const tables: FakeTables = {
    scans: (opts.scans ?? [SCAN_A]).map((id) => ({
      id,
      organization_id: ORG,
      project_id: PROJECT,
      status: opts.scanStatus ?? "completed",
      metrics: opts.ready === false ? {} : { [EVIDENCE_READY_KEY]: "2026-03-01T00:00:00.000Z" },
    })),
    security_jobs: jobs.map((j) => ({
      id: j.id,
      scan_id: j.scan,
      organization_id: ORG,
      project_id: PROJECT,
      engine: j.engine,
      status: j.status,
    })),
    production_verdicts: [],
  };
  calls.tables = tables as never;
  calls.log = [];
  return { tables, admin: createFakeAdmin(tables) };
}

const job = (id: string, engine: string, status: string, scan = SCAN_A): JobSeed => ({ id, scan, engine, status });
const finalize = (admin: unknown, scanId = SCAN_A, extra: Record<string, unknown> = {}) =>
  finalizeVerdictWhenEvidenceComplete(admin as never, {
    organizationId: ORG,
    projectId: PROJECT,
    scanId,
    ...extra,
  });

beforeEach(() => {
  vi.mocked(generateAndPersistProductionVerdict).mockClear();
});

describe("verdict is not finalized while engines are unfinished", () => {
  it("1: an unfinished engine -> no authoritative verdict is generated", async () => {
    const { tables, admin } = world([job("j1", "opengrep", "COMPLETED"), job("j2", "trivy", "RUNNING"), job("j3", "crypto", "QUEUED")]);
    const outcome = await finalize(admin);

    expect(outcome).toEqual({ status: "deferred", reason: "engines_pending", pendingEngines: ["trivy", "crypto"] });
    expect(calls.log).toEqual([]);
    expect(tables.production_verdicts).toHaveLength(0);
  });

  it("2: when the last engine completes, the verdict is generated -- and only then", async () => {
    const { tables, admin } = world([job("j1", "opengrep", "COMPLETED"), job("j2", "trivy", "RUNNING"), job("j3", "crypto", "COMPLETED")]);

    await finalize(admin);
    expect(calls.log).toEqual([]);

    // The security worker finishes the last engine: the terminal transition is
    // the event that finalizes the verdict.
    await transitionSecurityJob(admin as never, { jobId: "j2", from: "RUNNING", to: "COMPLETED" });
    expect(tables.security_jobs!.find((j) => j.id === "j2")!.status).toBe("COMPLETED");
    expect(calls.log).toEqual([`generate:${SCAN_A}`]);
    expect(tables.production_verdicts).toHaveLength(1);
  });

  it("2b: an intermediate engine completing does not finalize while another is still running", async () => {
    const { admin } = world([job("j1", "opengrep", "RUNNING"), job("j2", "trivy", "RUNNING")]);
    await transitionSecurityJob(admin as never, { jobId: "j1", from: "RUNNING", to: "COMPLETED" });
    expect(calls.log).toEqual([]);
  });
});

describe("engine failure and timeout are terminal facts, not in-flight work", () => {
  it("3: a failed engine finalizes the verdict, and the failure is what marks coverage incomplete", async () => {
    const { admin } = world([job("j1", "opengrep", "COMPLETED"), job("j2", "trivy", "FAILED"), job("j3", "crypto", "COMPLETED")]);

    expect((await finalize(admin)).status).toBe("generated");
    expect(await hasIncompleteExternalEngineCoverage(admin as never, { scanId: SCAN_A, organizationId: ORG })).toBe(true);
  });

  it("4: a timed-out engine finalizes the verdict, and the timeout marks coverage incomplete", async () => {
    const { admin } = world([job("j1", "opengrep", "COMPLETED"), job("j2", "trivy", "TIMED_OUT"), job("j3", "crypto", "COMPLETED")]);

    expect((await finalize(admin)).status).toBe("generated");
    expect(await hasIncompleteExternalEngineCoverage(admin as never, { scanId: SCAN_A, organizationId: ORG })).toBe(true);
  });

  it("a job that reaches FAILED via the worker's transition finalizes when it was the last one pending", async () => {
    const { admin } = world([job("j1", "opengrep", "COMPLETED"), job("j2", "trivy", "RUNNING")]);
    await transitionSecurityJob(admin as never, {
      jobId: "j2",
      from: "RUNNING",
      to: "FAILED",
      error: { code: "engine_error", message: "boom" },
    });
    expect(calls.log).toEqual([`generate:${SCAN_A}`]);
  });
});

describe("clean and duplicate completion", () => {
  it("5 + 9: all engines complete -> the final verdict is generated, with no engine flagged incomplete", async () => {
    const { admin } = world([job("j1", "opengrep", "COMPLETED"), job("j2", "trivy", "COMPLETED"), job("j3", "crypto", "COMPLETED")]);

    expect((await finalize(admin)).status).toBe("generated");
    expect(await hasIncompleteExternalEngineCoverage(admin as never, { scanId: SCAN_A, organizationId: ORG })).toBe(false);
  });

  it("6: a duplicate completion event is idempotent (one verdict, one generation)", async () => {
    const { tables, admin } = world([job("j1", "opengrep", "COMPLETED"), job("j2", "trivy", "RUNNING")]);

    await transitionSecurityJob(admin as never, { jobId: "j2", from: "RUNNING", to: "COMPLETED" });
    // The same terminal event arrives again (retry / redelivery) and the runner also finalizes.
    await transitionSecurityJob(admin as never, { jobId: "j2", from: "RUNNING", to: "COMPLETED" }).catch(() => undefined);
    const runnerOutcome = await finalize(admin);

    expect(runnerOutcome.status).toBe("already_exists");
    expect(calls.log).toEqual([`generate:${SCAN_A}`]);
    expect(tables.production_verdicts).toHaveLength(1);
  });

  it("8: a failed engine cannot later resurrect READY: the frozen verdict is never regenerated", async () => {
    const { tables, admin } = world([job("j1", "opengrep", "COMPLETED"), job("j2", "trivy", "FAILED")]);
    await finalize(admin);
    expect(calls.log).toHaveLength(1);

    // Later the same engine is retried and "completes", and another job event fires.
    tables.security_jobs!.find((j) => j.id === "j2")!.status = "COMPLETED";
    const later = await finalize(admin);

    expect(later.status).toBe("already_exists");
    expect(calls.log).toHaveLength(1);
  });
});

describe("evidence is bound to the scan", () => {
  it("7: a late engine completion for scan A never generates or alters anything for scan B", async () => {
    const { tables, admin } = world(
      [job("a1", "trivy", "RUNNING", SCAN_A), job("b1", "trivy", "RUNNING", SCAN_B)],
      { scans: [SCAN_A, SCAN_B] }
    );
    // Scan B's evidence is still incomplete; scan A's last engine finishes late.
    await transitionSecurityJob(admin as never, { jobId: "a1", from: "RUNNING", to: "COMPLETED" });

    expect(calls.log).toEqual([`generate:${SCAN_A}`]);
    expect(tables.production_verdicts!.map((v) => v.scan_id)).toEqual([SCAN_A]);
    expect((await finalize(admin, SCAN_B)).status).toBe("deferred");
  });

  it("a scan that is not completed (cancelled / failed / active) is never finalized", async () => {
    for (const status of ["cancelled", "failed", "scanning", "queued"]) {
      const { admin } = world([job("j1", "trivy", "COMPLETED")], { scanStatus: status });
      expect(await finalize(admin)).toEqual({ status: "skipped", reason: "scan_not_completed" });
      expect(calls.log).toEqual([]);
    }
  });

  it("a scan of another project is never finalized", async () => {
    const { admin } = world([job("j1", "trivy", "COMPLETED")]);
    const outcome = await finalizeVerdictWhenEvidenceComplete(admin as never, {
      organizationId: ORG,
      projectId: "99999999-9999-4999-8999-999999999999",
      scanId: SCAN_A,
    });
    expect(outcome).toEqual({ status: "skipped", reason: "scan_not_found" });
  });
});

describe("persistence happens after evidence is final", () => {
  it("10: with engine jobs, no generation until the scan's own pipeline has marked its evidence ready", async () => {
    const { admin } = world([job("j1", "trivy", "COMPLETED")], { ready: false });

    expect(await finalize(admin)).toEqual({ status: "deferred", reason: "evidence_not_ready", pendingEngines: [] });
    // A worker-side terminal event also cannot generate early.
    await transitionSecurityJob(admin as never, { jobId: "j1", from: "RUNNING", to: "COMPLETED" }).catch(() => undefined);
    expect(calls.log).toEqual([]);

    await markVerdictEvidenceReady(admin as never, { scanId: SCAN_A, organizationId: ORG });
    expect((await finalize(admin)).status).toBe("generated");
    expect(calls.log).toEqual([`generate:${SCAN_A}`]);
  });

  it("the runner finishing last and a job finishing last both end in exactly one verdict", async () => {
    // Order 1: jobs finish first, then the runner marks ready and finalizes.
    const first = world([job("j1", "trivy", "COMPLETED")], { ready: false });
    await markVerdictEvidenceReady(first.admin as never, { scanId: SCAN_A, organizationId: ORG });
    await finalize(first.admin);
    expect(calls.log).toEqual([`generate:${SCAN_A}`]);

    // Order 2: the runner marks ready first (engine still running), the job then finishes.
    const second = world([job("j1", "trivy", "RUNNING")], { ready: false });
    await markVerdictEvidenceReady(second.admin as never, { scanId: SCAN_A, organizationId: ORG });
    expect((await finalize(second.admin)).status).toBe("deferred");
    await transitionSecurityJob(second.admin as never, { jobId: "j1", from: "RUNNING", to: "COMPLETED" });
    expect(calls.log).toEqual([`generate:${SCAN_A}`]);
  });

  it("a deferred generation still uses the security decision the runner recorded", async () => {
    const { admin } = world([job("j1", "trivy", "RUNNING")], { ready: false });
    const decision = {
      decision: { deploymentVerdict: "DO_NOT_DEPLOY" as const, primaryRecommendation: "Fix it", confidence: "high" as const, decisionId: "dec-1" },
      explanation: { founder: { headline: "Do not deploy." } },
    };
    await markVerdictEvidenceReady(admin as never, { scanId: SCAN_A, organizationId: ORG, securityDecision: decision });
    await transitionSecurityJob(admin as never, { jobId: "j1", from: "RUNNING", to: "COMPLETED" });

    const input = vi.mocked(generateAndPersistProductionVerdict).mock.calls[0]?.[1];
    expect(input?.securityDecisionReport).toMatchObject({ decision: { decisionId: "dec-1", deploymentVerdict: "DO_NOT_DEPLOY" } });
  });

  it("unreadable job state defers instead of generating", async () => {
    const { admin } = world([job("j1", "trivy", "COMPLETED")]);
    const broken = {
      from(table: string) {
        if (table === "security_jobs") {
          const q = admin.from(table);
          q.eq = () => q;
          q.then = ((resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve)) as never;
          return q;
        }
        return admin.from(table);
      },
    };
    expect(await finalize(broken)).toMatchObject({ status: "deferred" });
    expect(calls.log).toEqual([]);
  });
});

describe("scans without engine jobs and crash recovery keep working", () => {
  it("a scan with no engine jobs (e.g. an upload) is finalized immediately", async () => {
    const { admin } = world([], { ready: false });
    expect((await finalize(admin)).status).toBe("generated");
  });

  it("recovery mode generates from whatever evidence exists (the runner that would finalize is gone)", async () => {
    const { admin } = world([job("j1", "trivy", "RUNNING")], { ready: false });
    expect((await finalize(admin, SCAN_A, { mode: "recovery" })).status).toBe("generated");
  });
});

describe("ensureProductionVerdictForCompletedScan honors the evidence lifecycle", () => {
  it("does not write a verdict while engines are still running, and does not throw", async () => {
    const { tables, admin } = world([job("j1", "opengrep", "COMPLETED"), job("j2", "trivy", "RUNNING")]);
    const result = await ensureProductionVerdictForCompletedScan(admin as never, {
      organizationId: ORG,
      projectId: PROJECT,
      scanId: SCAN_A,
    });
    expect(result).toEqual({ productionVerdictId: null, deferred: true });
    expect(calls.log).toEqual([]);
    expect(tables.production_verdicts).toHaveLength(0);
  });

  it("generates the verdict once the engines are all terminal", async () => {
    const { admin } = world([job("j1", "opengrep", "COMPLETED"), job("j2", "trivy", "COMPLETED")]);
    const result = await ensureProductionVerdictForCompletedScan(admin as never, {
      organizationId: ORG,
      projectId: PROJECT,
      scanId: SCAN_A,
    });
    expect(result.productionVerdictId).toBe(`v-${SCAN_A}`);
    expect(calls.log).toEqual([`generate:${SCAN_A}`]);
  });
});

describe("waitForScanVerdict is state-aware and bounded", () => {
  it("returns as soon as the evidence is complete (self-healing a missed event)", async () => {
    const { tables, admin } = world([job("j1", "trivy", "RUNNING")]);
    setTimeout(() => {
      tables.security_jobs![0].status = "COMPLETED";
    }, 15);

    const outcome = await waitForScanVerdict(admin as never, {
      organizationId: ORG,
      projectId: PROJECT,
      scanId: SCAN_A,
      maxMs: 500,
      intervalMs: 10,
    });
    expect(outcome.status).toBe("generated");
    expect(calls.log).toEqual([`generate:${SCAN_A}`]);
  });

  it("gives up after its budget with the deferral, never a fabricated verdict", async () => {
    const { admin } = world([job("j1", "trivy", "RUNNING")]);
    const outcome = await waitForScanVerdict(admin as never, {
      organizationId: ORG,
      projectId: PROJECT,
      scanId: SCAN_A,
      maxMs: 40,
      intervalMs: 10,
    });
    expect(outcome.status).toBe("deferred");
    expect(calls.log).toEqual([]);
  });
});
