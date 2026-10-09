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
import { mapSafeFixError } from "../http-errors";
import { reopenSafeFix, verifySafeFix } from "../verify";

describe("mapSafeFixError", () => {
  it.each([
    ["safe_fix_not_found", 404],
    ["proposal_commit_unsupported", 503],
    ["invalid_transition:READY->VERIFYING", 409],
    ["proposal_commit_locked", 409],
    ["proposal_commit_is_base_commit", 409],
    ["proposal_commit_conflict", 409],
  ])("%s -> %i", (message, status) => {
    expect(mapSafeFixError(new Error(message))?.status).toBe(status);
  });
  it("unknown errors and non-errors are not mapped (they stay real failures)", () => {
    expect(mapSafeFixError(new Error("boom"))).toBeNull();
    expect(mapSafeFixError("invalid_transition")).toBeNull();
    expect(mapSafeFixError(null)).toBeNull();
  });
});

describe("verifySafeFix outside APPLIED refuses BEFORE writing anything (engine level)", () => {
  const ORG = "org-a";
  const PROJECT = "11111111-1111-4111-8111-111111111111";
  const FIX = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  it.each(["PROPOSED", "READY", "APPROVED", "VERIFIED", "FAILED", "SUPERSEDED"])(
    "%s -> invalid_transition; record, lifecycle events and verifications are untouched",
    async (state) => {
      const record = {
        id: FIX, organization_id: ORG, project_id: PROJECT, recommendation_id: "rec", review_id: null, verdict_id: null, lifecycle_state: state,
        confidence_band: "HIGH", confidence_score: 80, document: {}, pr_draft: {}, baseline_snapshot: {},
        created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
      };
      const tables = { safe_fix_records: [record], safe_fix_lifecycle_events: [], safe_fix_verifications: [], scans: [] } as unknown as FakeTables;
      const before = JSON.stringify(tables.safe_fix_records![0]);
      await expect(
        verifySafeFix(createFakeAdmin(tables) as never, { safeFixId: FIX, organizationId: ORG, projectId: PROJECT })
      ).rejects.toThrow(`invalid_transition:${state}->VERIFYING`);
      expect(JSON.stringify(tables.safe_fix_records![0])).toBe(before);
      expect(tables.safe_fix_lifecycle_events).toEqual([]);
      expect(tables.safe_fix_verifications).toEqual([]);
    }
  );
});

describe("a verification that fails midway does not strand the record in VERIFYING", () => {
  const ORG = "org-a";
  const PROJECT = "11111111-1111-4111-8111-111111111111";
  const FIX = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  function world() {
    const tables = {
      safe_fix_records: [{
        id: FIX, organization_id: ORG, project_id: PROJECT, recommendation_id: "rec", review_id: null, verdict_id: null, lifecycle_state: "APPLIED",
        confidence_band: "HIGH", confidence_score: 80, document: {}, pr_draft: {}, baseline_snapshot: {},
        created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
      }],
      safe_fix_lifecycle_events: [], safe_fix_verifications: [], scans: [], production_verdicts: [], repository_scan_state: [],
    } as unknown as FakeTables;
    const real = createFakeAdmin(tables) as unknown as { from: (n: string) => unknown };
    // The database fails while storing the verification result (after the record is already VERIFYING).
    const admin = { from: (name: string) => { if (name === "safe_fix_verifications") throw new Error("connection reset"); return real.from(name); } } as never;
    return { tables, admin, real: real as never };
  }

  it("moves VERIFYING -> FAILED with an auditable reason, rethrows the real error, and reopen then works", async () => {
    const { tables, admin, real } = world();
    await expect(verifySafeFix(admin, { safeFixId: FIX, organizationId: ORG, projectId: PROJECT })).rejects.toThrow("connection reset");
    expect(tables.safe_fix_records![0].lifecycle_state).toBe("FAILED");
    const reasons = tables.safe_fix_lifecycle_events!.map((e) => `${e.from_state}->${e.to_state}:${String(e.reason).slice(0, 60)}`);
    expect(reasons).toEqual(["APPLIED->VERIFYING:verification_started", "VERIFYING->FAILED:verification_error:connection reset"]);
    expect(tables.safe_fix_verifications).toEqual([]);

    await reopenSafeFix(real, { safeFixId: FIX, organizationId: ORG, projectId: PROJECT, actor: "operator" });
    expect(tables.safe_fix_records![0].lifecycle_state).toBe("READY");
  });
});
