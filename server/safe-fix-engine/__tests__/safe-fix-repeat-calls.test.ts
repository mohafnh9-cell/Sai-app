import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/observability/metrics", () => ({ incrementMetricCounter: vi.fn() }));
vi.mock("@/server/observability/operation-timing", () => ({
  withOperationTiming: async (_name: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../memory-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../memory-bridge")>()),
  appendSafeFixMemoryEvent: vi.fn(async () => undefined),
}));

import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";
import { generateSafeFix } from "../generate";
import { enrichMcpSafeFixWithV2 } from "../mcp-enrichment";

// Repeated and concurrent safe_fix requests must not depend on the caller asking once.

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const SCAN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCAN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRIORITY = "priority-1";

const priority = {
  id: PRIORITY, title: "Missing ownership check", rank: 1, severity: "high", category: "authorization", reason: "r", confidence: "high",
  estimatedMinutes: 10, estimatedTimeLabel: "10 minutes", projectedScoreImpact: 10, recommendedAction: "Add an ownership check before returning the resource.",
  findingIds: ["f1"], affectedFiles: ["app/api/orders/route.ts"],
};

function world() {
  const verdict = (scanId: string, generatedAt: string, n: number) =>
    verdictRow(PROJECT, buildVerdictFixture({
      projectId: PROJECT, repositoryId: PROJECT, scanId, commitSha: scanId[0].repeat(40), status: "not_ready", score: 50, blockersCount: 1,
      generatedAt, topPriorities: [priority] as never,
    } as never), `d0000000-0000-4000-8000-00000000000${n}`, ORG);
  const tables = {
    production_verdicts: [verdict(SCAN_A, "2026-03-01T00:00:00.000Z", 1), verdict(SCAN_B, "2026-03-02T00:00:00.000Z", 2)],
    repository_scan_state: [{ repository_id: PROJECT, organization_id: ORG, current_verdict_id: "d0000000-0000-4000-8000-000000000002" }],
    scans: [{ id: SCAN_A, detected_stack: {} }, { id: SCAN_B, detected_stack: {} }],
    scan_findings: [], external_engine_findings: [], safe_fix_records: [], safe_fix_lifecycle_events: [], safe_fix_verifications: [],
  } as unknown as FakeTables;
  return { tables, admin: createFakeAdmin(tables) as never };
}
const call = (admin: never, scan: string = SCAN_A) =>
  generateSafeFix(admin, { organizationId: ORG, projectId: PROJECT, projectName: "demo", priorityId: PRIORITY, analysisRunId: scan, actor: "mcp" });
const open = (tables: FakeTables) => tables.safe_fix_records!.filter((r) => !["SUPERSEDED", "VERIFIED", "FAILED"].includes(r.lifecycle_state as string));
const force = (tables: FakeTables, state: string) => { tables.safe_fix_records![0].lifecycle_state = state; };

describe("same recommendation + same base analysis: the call is idempotent", () => {
  it("first call creates a READY proposal; the repeat returns it, creates nothing", async () => {
    const { tables, admin } = world();
    const first = await call(admin);
    expect(first).toMatchObject({ status: "ready" });
    const second = await call(admin);
    expect(second).toMatchObject({ status: "ready", reused: true });
    expect((second as { record: { id: string } }).record.id).toBe((first as { record: { id: string } }).record.id);
    expect(tables.safe_fix_records).toHaveLength(1);
  });

  it.each(["READY", "APPROVED", "APPLIED", "VERIFYING"])("a repeat while the record is %s returns it unchanged: state kept, no new events", async (state) => {
    const { tables, admin } = world();
    await call(admin);
    force(tables, state);
    const events = tables.safe_fix_lifecycle_events!.length;
    const again = await call(admin);
    expect(again).toMatchObject({ status: "ready", reused: true });
    expect(tables.safe_fix_records).toHaveLength(1);
    expect(tables.safe_fix_records![0].lifecycle_state).toBe(state);
    expect(tables.safe_fix_lifecycle_events).toHaveLength(events);
  });
});

describe("a newer base analysis", () => {
  it("replaces a never-approved proposal (superseded) with a fresh one", async () => {
    const { tables, admin } = world();
    await call(admin, SCAN_A);
    const next = await call(admin, SCAN_B);
    expect(next).toMatchObject({ status: "ready" });
    expect((next as { reused?: boolean }).reused).toBeUndefined();
    expect(tables.safe_fix_records!.map((r) => r.lifecycle_state)).toEqual(["SUPERSEDED", "READY"]);
    expect(open(tables)).toHaveLength(1);
  });

  it.each(["APPROVED", "APPLIED", "VERIFYING"])("a %s correction is NEVER superseded: explicit in_flight result, record kept, nothing created", async (state) => {
    const { tables, admin } = world();
    const created = await call(admin, SCAN_A);
    force(tables, state);
    const events = tables.safe_fix_lifecycle_events!.length;
    const blocked = await call(admin, SCAN_B);
    expect(blocked).toMatchObject({ status: "in_flight", reason: "different_base_analysis" });
    expect((blocked as { record: { id: string; lifecycleState: string } }).record).toMatchObject({ id: (created as { record: { id: string } }).record.id, lifecycleState: state });
    expect(tables.safe_fix_records).toHaveLength(1);
    expect(tables.safe_fix_records![0].lifecycle_state).toBe(state);
    expect(tables.safe_fix_lifecycle_events).toHaveLength(events);
  });

  it("terminal records (VERIFIED / FAILED / SUPERSEDED) do not block or get reused: a new proposal is created", async () => {
    for (const state of ["VERIFIED", "FAILED", "SUPERSEDED"]) {
      const { tables, admin } = world();
      await call(admin, SCAN_A);
      force(tables, state);
      const next = await call(admin, SCAN_A);
      expect(next).toMatchObject({ status: "ready" });
      expect(tables.safe_fix_records).toHaveLength(2);
      expect(tables.safe_fix_records![0].lifecycle_state).toBe(state);
    }
  });
});

describe("concurrent requests", () => {
  it.each([2, 5])("%i simultaneous identical calls leave exactly ONE open proposal and return the same record", async (n) => {
    const { tables, admin } = world();
    const results = await Promise.all(Array.from({ length: n }, () => call(admin)));
    expect(open(tables)).toHaveLength(1);
    const ids = new Set(results.map((r) => (r as { record: { id: string } }).record.id));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe(open(tables)[0].id);
    expect(results.every((r) => r.status === "ready")).toBe(true);
  });

  it("simultaneous requests on two different base analyses never produce two open proposals", async () => {
    const { tables, admin } = world();
    await Promise.all([call(admin, SCAN_A), call(admin, SCAN_B)]);
    expect(open(tables)).toHaveLength(1);
  });

  it("an approval landing between the check and the supersede is not overwritten (the state condition is in the UPDATE)", async () => {
    const { tables, admin: real } = world();
    await call(real, SCAN_A);
    // The record is approved by someone else exactly when the supersede statement runs.
    let flipped = false;
    const admin = new Proxy(real as object, {
      get(target, prop, receiver) {
        if (prop === "from") {
          return (name: string) => {
            const builder = (target as { from: (n: string) => Record<string, (...a: unknown[]) => unknown> }).from(name);
            if (name !== "safe_fix_records") return builder;
            return new Proxy(builder, {
              get(b, p, r) {
                if (p === "update" && !flipped) {
                  return (values: Record<string, unknown>) => {
                    if (values.lifecycle_state === "SUPERSEDED") { flipped = true; tables.safe_fix_records![0].lifecycle_state = "APPROVED"; }
                    return (b as unknown as { update: (v: unknown) => unknown }).update(values);
                  };
                }
                return Reflect.get(b, p, r);
              },
            });
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as never;
    const result = await call(admin, SCAN_B);
    expect(flipped).toBe(true);
    expect(tables.safe_fix_records![0].lifecycle_state).toBe("APPROVED"); // preserved
    // The new proposal that raced it did not survive next to an approved one.
    expect(open(tables).filter((r) => r.lifecycle_state === "APPROVED")).toHaveLength(1);
    expect(open(tables)).toHaveLength(1);
    expect(result).toMatchObject({ status: "in_flight" });
  });

  it("a unique-violation on insert (migration 068) is resolved by returning the winner", async () => {
    const { tables, admin: real } = world();
    await call(real, SCAN_A);
    const winnerId = tables.safe_fix_records![0].id as string;
    // Simulate the race: the winner is created by another request just after our pre-check.
    const hidden = tables.safe_fix_records!.splice(0, 1);
    let injected = false;
    const admin = new Proxy(real as object, {
      get(target, prop, receiver) {
        if (prop === "from") {
          return (name: string) => {
            const builder = (target as { from: (n: string) => Record<string, (...a: unknown[]) => unknown> }).from(name);
            if (name !== "safe_fix_records") return builder;
            return new Proxy(builder, {
              get(b, p, r) {
                if (p === "insert") {
                  return () => {
                    tables.safe_fix_records!.push(...hidden); // the concurrent request's row becomes visible...
                    injected = true;
                    const chain: Record<string, unknown> = {};
                    for (const m of ["select", "single", "maybeSingle"]) chain[m] = () => chain;
                    chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } });
                    return chain;
                  };
                }
                return Reflect.get(b, p, r);
              },
            });
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as never;
    const result = await call(admin);
    expect(injected).toBe(true);
    expect(result).toMatchObject({ status: "ready", reused: true });
    expect((result as { record: { id: string } }).record.id).toBe(winnerId);
    expect(tables.safe_fix_records).toHaveLength(1);
  });
});

describe("MCP safe_fix enrichment surfaces the outcome explicitly", () => {
  const mcpResult = { status: "prompt_ready", project: { id: PROJECT, name: "demo" }, blocker: { id: PRIORITY, title: "Missing ownership check", severity: "high", category: "authorization" }, summary: "instructions" };

  it("repeat -> safeFixStatus 'reused' with the same record; in-flight on an older analysis -> 'in_flight' with an explicit note and the record kept", async () => {
    const { tables, admin } = world();
    // The MCP path uses the CURRENT verdict (SCAN_B).
    const first = await enrichMcpSafeFixWithV2(admin, ORG, mcpResult);
    expect(first.safeFixStatus).toBe("created");
    const again = await enrichMcpSafeFixWithV2(admin, ORG, mcpResult);
    expect(again.safeFixStatus).toBe("reused");
    expect(again.safeFixV2?.id).toBe(first.safeFixV2?.id);
    expect(again.safeFixNote).toContain("reused, not duplicated");

    // The correction is approved on SCAN_B; the project then moves to a newer analysis (SCAN_A made current for the test).
    tables.safe_fix_records![0].lifecycle_state = "APPROVED";
    tables.safe_fix_records![0].review_id = SCAN_A; // built on another analysis than the current one (SCAN_B)
    const blocked = await enrichMcpSafeFixWithV2(admin, ORG, mcpResult);
    expect(blocked.safeFixStatus).toBe("in_flight");
    expect(blocked.safeFixNote).toContain("kept unchanged");
    expect(tables.safe_fix_records).toHaveLength(1);
    expect(tables.safe_fix_records![0].lifecycle_state).toBe("APPROVED");
  });
});
