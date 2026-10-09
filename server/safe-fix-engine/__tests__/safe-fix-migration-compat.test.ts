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
import { getSafeFixById } from "../history";
import { setSafeFixProposalCommit, isMissingProposalCommitColumn } from "../proposal-commit";
import { summarizeSafeFixImpact } from "../memory-bridge";
import { approveSafeFix, markSafeFixApplied } from "../verify";

// Deployment order safety for migration 067 (safe_fix_records.proposal_commit_sha):
//  - code deployed BEFORE the migration: every READ works (select("*") -> column absent -> unbound);
//    every WRITE of the column is refused up front with `proposal_commit_unsupported`, with no side effects.
//  - migration applied BEFORE the code: the column is nullable and unread -> no effect.

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const FIX = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SHA = "b".repeat(40);
const scope = { organizationId: ORG, projectId: PROJECT };
const ids = { safeFixId: FIX, organizationId: ORG, projectId: PROJECT, actor: "u" };

const row = (state: string) => ({
  id: FIX, organization_id: ORG, project_id: PROJECT, recommendation_id: "rec", review_id: null, verdict_id: null, lifecycle_state: state,
  confidence_band: "HIGH", confidence_score: 80, document: {}, pr_draft: {}, baseline_snapshot: {},
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", // NO proposal_commit_sha key: pre-067 shape
});

/** Emulates PostgREST on a database where the column does not exist yet. */
function preMigrationAdmin(state: string) {
  const tables = { safe_fix_records: [row(state)], safe_fix_lifecycle_events: [] } as unknown as FakeTables;
  const real = createFakeAdmin(tables) as unknown as { from: (n: string) => Record<string, (...a: unknown[]) => unknown> };
  const failing = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["eq", "is", "limit", "select", "order", "maybeSingle", "single"]) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { code: "42703", message: 'column "proposal_commit_sha" does not exist' } });
    return chain;
  };
  const admin = {
    from(name: string) {
      const builder = real.from(name);
      if (name !== "safe_fix_records") return builder;
      return new Proxy(builder, {
        get(target, prop, receiver) {
          if (prop === "select") {
            return (cols?: unknown, ...rest: unknown[]) =>
              typeof cols === "string" && cols.includes("proposal_commit_sha") ? failing() : target.select(cols, ...rest);
          }
          if (prop === "update") {
            return (payload: Record<string, unknown>) =>
              "proposal_commit_sha" in payload ? failing() : target.update(payload);
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    },
  };
  return { admin: admin as never, tables };
}

describe("code deployed before migration 067", () => {
  it("reads are unaffected: the record loads as unbound (proposalCommitSha null)", async () => {
    const { admin } = preMigrationAdmin("READY");
    expect((await getSafeFixById(admin, FIX, scope))?.proposalCommitSha).toBeNull();
  });

  it("recording a commit is refused up front with a clear error and NO side effect, even from VERIFIED", async () => {
    for (const state of ["VERIFIED", "APPROVED", "FAILED"]) {
      const { admin, tables } = preMigrationAdmin(state);
      await expect(setSafeFixProposalCommit(admin, { safeFixId: FIX, scope, commitSha: SHA, actor: "u" })).rejects.toThrow("proposal_commit_unsupported");
      expect(tables.safe_fix_records![0].lifecycle_state).toBe(state);
      expect(tables.safe_fix_lifecycle_events).toEqual([]);
    }
  });

  it("applied WITH a commit is refused and leaves the record APPROVED; applied WITHOUT one keeps working (documentary flow)", async () => {
    const { admin, tables } = preMigrationAdmin("READY");
    await approveSafeFix(admin, ids);
    await expect(markSafeFixApplied(admin, { ...ids, commitSha: SHA })).rejects.toThrow("proposal_commit_unsupported");
    expect(tables.safe_fix_records![0].lifecycle_state).toBe("APPROVED");
    expect(await markSafeFixApplied(admin, ids)).toEqual({ binding: "assisted_unbound" });
    expect(tables.safe_fix_records![0].lifecycle_state).toBe("APPLIED");
  });

  it("the report summary still works and reports no exact-commit verifications", async () => {
    const { admin } = preMigrationAdmin("VERIFIED");
    const summary = await summarizeSafeFixImpact(admin, scope, "2026-10-01", "2026-10-31");
    expect(summary).toMatchObject({ proposed: 1, verified: 1, verifiedExactCommit: 0 });
  });

  it("error classification", () => {
    expect(isMissingProposalCommitColumn({ code: "42703" })).toBe(true);
    expect(isMissingProposalCommitColumn({ code: "PGRST204", message: "x" })).toBe(true);
    expect(isMissingProposalCommitColumn({ message: "column proposal_commit_sha does not exist" })).toBe(true);
    expect(isMissingProposalCommitColumn({ code: "23505", message: "duplicate" })).toBe(false);
    expect(isMissingProposalCommitColumn(null)).toBe(false);
  });
});

describe("migration applied (column present)", () => {
  it("the report summary separates exact-commit verifications from assisted (unbound) ones", async () => {
    const tables = {
      safe_fix_records: [
        { ...row("VERIFIED"), id: "v1", proposal_commit_sha: SHA },
        { ...row("VERIFIED"), id: "v2", proposal_commit_sha: null },
      ],
    } as unknown as FakeTables;
    const summary = await summarizeSafeFixImpact(createFakeAdmin(tables) as never, scope, "2026-10-01", "2026-10-31");
    expect(summary).toMatchObject({ verified: 2, verifiedExactCommit: 1 });
  });
});
