import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../memory-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../memory-bridge")>()),
  appendSafeFixMemoryEvent: vi.fn(async () => undefined),
}));

import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import {
  getSafeFixById,
  listSafeFixHistory,
  storeSafeFixHistoryUpdate,
  supersedeOpenFixesForRecommendation,
} from "../history";
import { transitionSafeFixState } from "../lifecycle";
import { summarizeSafeFixImpact } from "../memory-bridge";
import { verifySafeFix } from "../verify";

// The service-role client bypasses RLS, so every Safe Fix access must carry organization + project.

const ORG_A = "org-a";
const ORG_B = "org-b";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_A2 = "22222222-2222-4222-8222-222222222222";
const PROJECT_B = "33333333-3333-4333-8333-333333333333";
const FIX_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIX_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const row = (id: string, org: string, project: string, over: Record<string, unknown> = {}) => ({
  id, organization_id: org, project_id: project, recommendation_id: "rec-1", review_id: null, verdict_id: null,
  lifecycle_state: "READY", confidence_band: "HIGH", confidence_score: 80, document: {}, pr_draft: {}, baseline_snapshot: {},
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", ...over,
});

function world() {
  const tables = {
    safe_fix_records: [row(FIX_A, ORG_A, PROJECT_A), row(FIX_B, ORG_B, PROJECT_B)],
    safe_fix_lifecycle_events: [],
    safe_fix_verifications: [],
    scans: [],
  } as unknown as FakeTables;
  return { tables, admin: createFakeAdmin(tables) as never };
}

const A = { organizationId: ORG_A, projectId: PROJECT_A };

describe("getSafeFixById is scoped to organization AND project", () => {
  it("returns the record inside its scope", async () => {
    expect((await getSafeFixById(world().admin, FIX_A, A))?.id).toBe(FIX_A);
  });
  it("another organization -> not found (even with the right project id)", async () => {
    expect(await getSafeFixById(world().admin, FIX_A, { organizationId: ORG_B, projectId: PROJECT_A })).toBeNull();
  });
  it("another project of the same organization -> not found", async () => {
    expect(await getSafeFixById(world().admin, FIX_A, { organizationId: ORG_A, projectId: PROJECT_A2 })).toBeNull();
  });
  it("a foreign record id inside my scope -> not found", async () => {
    expect(await getSafeFixById(world().admin, FIX_B, A)).toBeNull();
  });
});

describe("writes cannot cross a tenant boundary", () => {
  it("transition on a foreign record fails closed: no state change, no lifecycle event", async () => {
    const { admin, tables } = world();
    await expect(
      transitionSafeFixState(admin, { safeFixId: FIX_B, organizationId: ORG_A, projectId: PROJECT_A, toState: "APPROVED", actor: "x", reason: "r" })
    ).rejects.toThrow("safe_fix_not_found");
    expect(tables.safe_fix_records![1].lifecycle_state).toBe("READY");
    expect(tables.safe_fix_lifecycle_events).toEqual([]);
  });

  it("history update on a foreign record throws and changes nothing", async () => {
    const { admin, tables } = world();
    await expect(storeSafeFixHistoryUpdate(admin, FIX_B, { lifecycleState: "FAILED" }, A)).rejects.toThrow("safe_fix_not_found");
    expect(tables.safe_fix_records![1].lifecycle_state).toBe("READY");
  });

  it("supersede only touches the caller's organization/project", async () => {
    const { admin, tables } = world();
    await supersedeOpenFixesForRecommendation(admin, A, "rec-1");
    expect(tables.safe_fix_records![0].lifecycle_state).toBe("SUPERSEDED");
    expect(tables.safe_fix_records![1].lifecycle_state).toBe("READY");
  });

  it("verify / approve flows reject a record outside the scope", async () => {
    const { admin } = world();
    await expect(verifySafeFix(admin, { safeFixId: FIX_B, organizationId: ORG_A, projectId: PROJECT_A })).rejects.toThrow("safe_fix_not_found");
    await expect(verifySafeFix(admin, { safeFixId: FIX_A, organizationId: ORG_B, projectId: PROJECT_A })).rejects.toThrow("safe_fix_not_found");
    await expect(verifySafeFix(admin, { safeFixId: FIX_A, organizationId: ORG_A, projectId: PROJECT_A2 })).rejects.toThrow("safe_fix_not_found");
  });
});

describe("reads are scoped", () => {
  it("history lists only the scope's records", async () => {
    const { admin } = world();
    expect((await listSafeFixHistory(admin, A)).map((r) => r.id)).toEqual([FIX_A]);
    expect(await listSafeFixHistory(admin, { organizationId: ORG_A, projectId: PROJECT_B })).toEqual([]);
  });

  it("the report summary counts only the scope's records", async () => {
    const { admin } = world();
    const mine = await summarizeSafeFixImpact(admin, A, "2026-10-01", "2026-10-31");
    expect(mine.proposed).toBe(1);
    const crossed = await summarizeSafeFixImpact(admin, { organizationId: ORG_A, projectId: PROJECT_B }, "2026-10-01", "2026-10-31");
    expect(crossed.proposed).toBe(0);
  });
});
