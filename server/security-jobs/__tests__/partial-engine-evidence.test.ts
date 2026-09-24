import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  engineResult: null as null | Record<string, unknown>,
  tables: null as null | Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("@/server/security-engines/registry", () => ({
  listExternalAndNativeAdjacentEngines: () => [
    {
      id: "trivy",
      version: "test",
      execute: async () => state.engineResult,
    },
  ],
}));

// Persist the engine's own result like the real persistEngineResults does
// (engine_executions keeps the engine's PARTIAL status).
vi.mock("@/server/security-engines/persistence", () => ({
  persistEngineResults: async (
    _admin: unknown,
    input: { scanId: string; organizationId: string; projectId: string; results: Array<Record<string, unknown>> }
  ) => {
    for (const r of input.results) {
      state.tables?.engine_executions.push({
        scan_id: input.scanId,
        organization_id: input.organizationId,
        project_id: input.projectId,
        engine: r.engine,
        status: r.status,
        created_at: new Date().toISOString(),
      });
    }
    return { findingsPersisted: 0, executionsPersisted: input.results.length, correlationsPersisted: 0 };
  },
}));

import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { hasIncompleteExternalEngineCoverage } from "@/server/security-orchestrator/verdict-integration";
import { ENGINE_PARTIAL_ERROR_CODE, jobOutcomeFromEngineResult } from "../engine-result-status";
import { transitionSecurityJob } from "../service";
import { runClaimedSecurityJob } from "../worker-run-job";
import type { SecurityJob } from "../types";

// Pass 4B NEW-1: an engine PARTIAL result must never become a COMPLETED job,
// and SequrAI must never treat partial or incomplete engine evidence as complete.

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const SCAN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCAN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function result(status: string, errors: Array<{ code: string; message: string }> = [], scanId = SCAN_A) {
  return {
    engine: "trivy",
    engineVersion: "test",
    executionId: `exec-${status}`,
    scanId,
    projectId: PROJECT,
    organizationId: ORG,
    status,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 1,
    capabilitiesAttempted: [],
    capabilitiesCompleted: [],
    findings: [],
    evidence: [],
    metrics: {},
    errors,
  };
}

function job(id: string, scanId = SCAN_A): SecurityJob {
  return {
    id,
    organizationId: ORG,
    projectId: PROJECT,
    scanId,
    engine: "trivy",
    engineVersion: "test",
    capabilities: [],
    attempt: 1,
    timeoutMs: 1000,
  } as unknown as SecurityJob;
}

function world(jobs: Array<{ id: string; scan: string; engine: string; status: string; at: string }> = []) {
  const tables: FakeTables = {
    scans: [SCAN_A, SCAN_B].map((id) => ({ id, organization_id: ORG, project_id: PROJECT, status: "completed", metrics: {} })),
    security_jobs: jobs.map((j) => ({
      id: j.id,
      scan_id: j.scan,
      organization_id: ORG,
      project_id: PROJECT,
      engine: j.engine,
      status: j.status,
      requested_at: j.at,
    })),
    engine_executions: [],
    production_verdicts: [],
    security_job_events: [],
  };
  state.tables = tables as never;
  return { tables, admin: createFakeAdmin(tables) };
}

const incomplete = (admin: unknown, scanId = SCAN_A) =>
  hasIncompleteExternalEngineCoverage(admin as never, { scanId, organizationId: ORG });

beforeEach(() => {
  state.engineResult = null;
});

describe("engine result -> job status contract", () => {
  it("COMPLETED stays COMPLETED", () => {
    expect(jobOutcomeFromEngineResult({ status: "COMPLETED", errors: [] })).toEqual({ status: "COMPLETED", error: null });
  });

  it("PARTIAL is NEVER COMPLETED and stays distinguishable by its error code", () => {
    const outcome = jobOutcomeFromEngineResult({
      status: "PARTIAL",
      errors: [{ code: "file_scan_failed", message: "a.ts: boom" }],
    });
    expect(outcome.status).not.toBe("COMPLETED");
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error?.code).toBe(ENGINE_PARTIAL_ERROR_CODE);
    expect(outcome.error?.message).toContain("file_scan_failed");
  });

  it("PARTIAL without recorded errors is still incomplete", () => {
    expect(jobOutcomeFromEngineResult({ status: "PARTIAL", errors: [] }).status).toBe("FAILED");
  });

  it("FAILED, timeout and cancellation are each represented, none as COMPLETED", () => {
    expect(jobOutcomeFromEngineResult({ status: "FAILED", errors: [{ code: "scan_failed", message: "x" }] }).status).toBe("FAILED");
    expect(jobOutcomeFromEngineResult({ status: "FAILED", errors: [{ code: "timeout", message: "x" }] }).status).toBe("TIMED_OUT");
    expect(jobOutcomeFromEngineResult({ status: "FAILED", errors: [{ code: "cancelled", message: "x" }] }).status).toBe("CANCELLED");
  });

  it("SKIPPED and non-terminal engine results are failures, never completions", () => {
    for (const status of ["SKIPPED", "QUEUED", "RUNNING"] as const) {
      expect(jobOutcomeFromEngineResult({ status, errors: [] }).status).toBe("FAILED");
    }
  });
});

describe("the worker records a PARTIAL engine as an incomplete job", () => {
  async function runWith(status: string, errors: Array<{ code: string; message: string }> = []) {
    const { tables, admin } = world([{ id: "j1", scan: SCAN_A, engine: "trivy", status: "RUNNING", at: "2026-03-01T00:00:01.000Z" }]);
    state.engineResult = result(status, errors);
    const run = await runClaimedSecurityJob(admin as never, job("j1"), { preFetchedFiles: [{ path: "a.ts", content: "x" }], githubRepo: "acme/repo" });
    return { tables, admin, run, row: tables.security_jobs![0] };
  }

  it("PARTIAL -> job FAILED with engine_partial, and coverage is incomplete (the NEW-1 regression)", async () => {
    const { admin, run, row } = await runWith("PARTIAL", [{ code: "file_scan_failed", message: "a.ts: boom" }]);
    expect(run.status).not.toBe("COMPLETED");
    expect(row.status).toBe("FAILED");
    expect((row.error as { code: string }).code).toBe(ENGINE_PARTIAL_ERROR_CODE);
    expect(await incomplete(admin)).toBe(true);
  });

  it("COMPLETED -> job COMPLETED and coverage is complete", async () => {
    const { admin, row } = await runWith("COMPLETED");
    expect(row.status).toBe("COMPLETED");
    expect(await incomplete(admin)).toBe(false);
  });

  it("FAILED -> incomplete", async () => {
    const { admin, row } = await runWith("FAILED", [{ code: "scan_failed", message: "trivy exited 2" }]);
    expect(row.status).toBe("FAILED");
    expect(await incomplete(admin)).toBe(true);
  });

  it("an engine timeout -> TIMED_OUT and incomplete", async () => {
    const { admin, row } = await runWith("FAILED", [{ code: "timeout", message: "exceeded" }]);
    expect(row.status).toBe("TIMED_OUT");
    expect(await incomplete(admin)).toBe(true);
  });
});

describe("hasIncompleteExternalEngineCoverage (metamorphic)", () => {
  const complete = (id: string, engine: string) => ({ id, scan: SCAN_A, engine, status: "COMPLETED", at: "2026-03-01T00:00:01.000Z" });

  it("A: all engines COMPLETED -> full engine coverage", async () => {
    const { admin } = world([complete("1", "opengrep"), complete("2", "trivy"), complete("3", "crypto")]);
    expect(await incomplete(admin)).toBe(false);
  });

  it.each(["FAILED", "TIMED_OUT", "RUNNING", "QUEUED", "CANCELLED", "REJECTED"])(
    "%s engine -> incomplete coverage",
    async (status) => {
      const { admin } = world([complete("1", "opengrep"), { ...complete("2", "trivy"), status }, complete("3", "crypto")]);
      expect(await incomplete(admin)).toBe(true);
    }
  );

  it("B: a job row that says COMPLETED but whose persisted engine execution is PARTIAL -> incomplete (defense in depth / legacy rows)", async () => {
    const { tables, admin } = world([complete("1", "opengrep"), complete("2", "trivy")]);
    tables.engine_executions!.push({ scan_id: SCAN_A, organization_id: ORG, engine: "trivy", status: "PARTIAL", created_at: "2026-03-01T00:00:02.000Z" });
    expect(await incomplete(admin)).toBe(true);
  });

  it("a persisted SKIPPED or FAILED execution behind a COMPLETED job is also incomplete", async () => {
    for (const status of ["SKIPPED", "FAILED"]) {
      const { tables, admin } = world([complete("1", "trivy")]);
      tables.engine_executions!.push({ scan_id: SCAN_A, organization_id: ORG, engine: "trivy", status, created_at: "2026-03-01T00:00:02.000Z" });
      expect(await incomplete(admin)).toBe(true);
    }
  });

  it("G: a duplicate completion event is idempotent and never turns a partial engine complete", async () => {
    const { tables, admin } = world([{ id: "j1", scan: SCAN_A, engine: "trivy", status: "RUNNING", at: "2026-03-01T00:00:01.000Z" }]);
    await transitionSecurityJob(admin as never, { jobId: "j1", from: "RUNNING", to: "FAILED", error: { code: ENGINE_PARTIAL_ERROR_CODE, message: "partial" } });
    // The same/late event arrives again (even claiming COMPLETED): the state machine rejects it.
    await expect(transitionSecurityJob(admin as never, { jobId: "j1", from: "FAILED" as never, to: "COMPLETED" })).rejects.toThrow();
    await transitionSecurityJob(admin as never, { jobId: "j1", from: "RUNNING", to: "COMPLETED" }); // stale expected state: no-op
    expect(tables.security_jobs![0].status).toBe("FAILED");
    expect(await incomplete(admin)).toBe(true);
  });

  it("H: a PARTIAL run followed by a genuine COMPLETED rerun -> the LATEST execution decides (complete)", async () => {
    const { tables, admin } = world([
      { id: "old", scan: SCAN_A, engine: "trivy", status: "FAILED", at: "2026-03-01T00:00:01.000Z" },
      { id: "new", scan: SCAN_A, engine: "trivy", status: "COMPLETED", at: "2026-03-01T00:05:00.000Z" },
    ]);
    tables.engine_executions!.push(
      { scan_id: SCAN_A, organization_id: ORG, engine: "trivy", status: "PARTIAL", created_at: "2026-03-01T00:00:30.000Z" },
      { scan_id: SCAN_A, organization_id: ORG, engine: "trivy", status: "COMPLETED", created_at: "2026-03-01T00:05:30.000Z" }
    );
    expect(await incomplete(admin)).toBe(false);
  });

  it("H2: an earlier COMPLETED run does not hide a later PARTIAL rerun", async () => {
    const { tables, admin } = world([
      { id: "old", scan: SCAN_A, engine: "trivy", status: "COMPLETED", at: "2026-03-01T00:00:01.000Z" },
      { id: "new", scan: SCAN_A, engine: "trivy", status: "FAILED", at: "2026-03-01T00:05:00.000Z" },
    ]);
    tables.engine_executions!.push(
      { scan_id: SCAN_A, organization_id: ORG, engine: "trivy", status: "COMPLETED", created_at: "2026-03-01T00:00:30.000Z" },
      { scan_id: SCAN_A, organization_id: ORG, engine: "trivy", status: "PARTIAL", created_at: "2026-03-01T00:05:30.000Z" }
    );
    expect(await incomplete(admin)).toBe(true);
  });

  it("I: a late PARTIAL for scan A does not affect scan B", async () => {
    const { tables, admin } = world([
      { id: "a1", scan: SCAN_A, engine: "trivy", status: "FAILED", at: "2026-03-01T00:00:01.000Z" },
      { id: "b1", scan: SCAN_B, engine: "trivy", status: "COMPLETED", at: "2026-03-01T00:00:02.000Z" },
    ]);
    tables.engine_executions!.push(
      { scan_id: SCAN_A, organization_id: ORG, engine: "trivy", status: "PARTIAL", created_at: "2026-03-01T00:10:00.000Z" },
      { scan_id: SCAN_B, organization_id: ORG, engine: "trivy", status: "COMPLETED", created_at: "2026-03-01T00:00:03.000Z" }
    );
    expect(await incomplete(admin, SCAN_A)).toBe(true);
    expect(await incomplete(admin, SCAN_B)).toBe(false);
  });

  it("a scan with no engine jobs at all (native-only) is not flagged", async () => {
    const { admin } = world([]);
    expect(await incomplete(admin)).toBe(false);
  });

  it("an unreadable job or execution table fails closed (incomplete)", async () => {
    const { admin } = world([complete("1", "trivy")]);
    const broken = {
      from(table: string) {
        const q = admin.from(table);
        if (table === "engine_executions") {
          q.then = ((resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve)) as never;
        }
        return q;
      },
    };
    expect(await incomplete(broken)).toBe(true);
  });
});
