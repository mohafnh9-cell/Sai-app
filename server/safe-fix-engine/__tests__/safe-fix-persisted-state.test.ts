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

// A safe_fix result reports the state that is PERSISTED when the call returns (not the object captured mid-call).

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

const persistedState = (tables: FakeTables, id: string) => tables.safe_fix_records!.find((r) => r.id === id)!.lifecycle_state;
type Rec = { id: string; lifecycleState: string };

describe("safe_fix reports the persisted lifecycle state", () => {
  it("a new proposal is returned as READY (it is inserted as PROPOSED and moved to READY inside the call), matching the row", async () => {
    const { tables, admin } = world();
    const result = (await call(admin)) as { status: string; record: Rec };
    expect(result.status).toBe("ready");
    expect(result.record.lifecycleState).toBe("READY");
    expect(persistedState(tables, result.record.id)).toBe("READY");
    expect(tables.safe_fix_lifecycle_events!.map((e) => `${e.from_state}->${e.to_state}`)).toEqual(["PROPOSED->READY"]);
  });

  it("a reused proposal reports the state it has now, including after it moved on", async () => {
    const { tables, admin } = world();
    await call(admin);
    for (const state of ["READY", "APPROVED", "APPLIED", "VERIFYING"]) {
      force(tables, state);
      const again = (await call(admin)) as { status: string; reused?: boolean; record: Rec };
      expect(again).toMatchObject({ status: "ready", reused: true });
      expect(again.record.lifecycleState).toBe(state);
      expect(persistedState(tables, again.record.id)).toBe(state);
    }
  });

  it("in_flight reports the in-flight record's actual state, untouched", async () => {
    const { tables, admin } = world();
    await call(admin, SCAN_A);
    force(tables, "APPROVED");
    const result = (await call(admin, SCAN_B)) as { status: string; reason?: string; record: Rec };
    expect(result).toMatchObject({ status: "in_flight", reason: "different_base_analysis" });
    expect(result.record.lifecycleState).toBe("APPROVED");
    expect(persistedState(tables, result.record.id)).toBe("APPROVED");
  });

  it("concurrent creations: every returned record carries the state its row has", async () => {
    const { tables, admin } = world();
    const results = (await Promise.all([call(admin), call(admin), call(admin)])) as Array<{ record: Rec }>;
    for (const { record } of results) expect(record.lifecycleState).toBe(persistedState(tables, record.id));
    expect(open(tables)).toHaveLength(1);
  });

  it("the MCP document exposes the same persisted state (created, reused, in_flight)", async () => {
    const { tables, admin } = world();
    const mcpResult = { status: "prompt_ready", project: { id: PROJECT, name: "demo" }, blocker: { id: PRIORITY, title: "Missing ownership check", severity: "high", category: "authorization" }, summary: "instructions" };
    const created = await enrichMcpSafeFixWithV2(admin, ORG, mcpResult);
    expect(created).toMatchObject({ safeFixStatus: "created", safeFixV2: { lifecycleState: "READY" } });

    force(tables, "APPROVED");
    const reused = await enrichMcpSafeFixWithV2(admin, ORG, mcpResult);
    expect(reused).toMatchObject({ safeFixStatus: "reused", safeFixV2: { lifecycleState: "APPROVED" } });

    tables.safe_fix_records![0].review_id = SCAN_A; // built on an older analysis than the current one
    const blocked = await enrichMcpSafeFixWithV2(admin, ORG, mcpResult);
    expect(blocked).toMatchObject({ safeFixStatus: "in_flight", safeFixV2: { lifecycleState: "APPROVED" } });
    expect(persistedState(tables, blocked.safeFixV2!.id)).toBe("APPROVED");
  });
});
