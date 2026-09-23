import { describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

vi.mock("server-only", () => ({}));

import { releaseActiveScan, writeScanStatePointer } from "../scan-state-writer";

// Phase Z v2 Pass 3 (CRIT-002 / CRIT-005): the current-scan pointer must
// only move forward, at the persistence boundary, regardless of the order in
// which scan workers happen to finish.

const ORG = "66666666-6666-4666-8666-666666666666";
const PROJECT = "55555555-5555-4555-8555-555555555555";
const OTHER_PROJECT = "77777777-7777-4777-8777-777777777777";
const SCAN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCAN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SCAN_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VERDICT_A = "a0000000-0000-4000-8000-00000000000a";
const VERDICT_B = "b0000000-0000-4000-8000-00000000000b";

function world(overrides: Partial<FakeTables> = {}): FakeTables {
  return {
    projects: [{ id: PROJECT, organization_id: ORG, github_default_branch: "main" }],
    scans: [
      { id: SCAN_A, repository_id: PROJECT, branch: "main", created_at: "2026-03-01T00:00:00.000Z" },
      { id: SCAN_B, repository_id: PROJECT, branch: "main", created_at: "2026-03-02T00:00:00.000Z" },
      { id: SCAN_C, repository_id: PROJECT, branch: "main", created_at: "2026-03-03T00:00:00.000Z" },
    ],
    repository_scan_state: [],
    ...overrides,
  };
}

function pointer(scanId: string, verdictId: string) {
  return { current_verdict_id: verdictId, last_scan_id: scanId, last_security_score: 90 };
}

function write(tables: FakeTables, scanId: string, verdictId: string) {
  return writeScanStatePointer(createFakeAdmin(tables) as never, {
    organizationId: ORG,
    projectId: PROJECT,
    scanId,
    values: pointer(scanId, verdictId),
  });
}

function state(tables: FakeTables) {
  return tables.repository_scan_state![0];
}

describe("writeScanStatePointer: ordering", () => {
  it("A: A starts, B starts, B completes, A completes later -> B stays current", async () => {
    const tables = world();
    expect((await write(tables, SCAN_B, VERDICT_B)).applied).toBe(true);

    const late = await write(tables, SCAN_A, VERDICT_A);

    expect(late).toEqual({ applied: false, reason: "stale_writer" });
    expect(state(tables).last_scan_id).toBe(SCAN_B);
    expect(state(tables).current_verdict_id).toBe(VERDICT_B);
  });

  it("B: A completes, then A's retry runs later -> no state change beyond idempotent rewrite", async () => {
    const tables = world();
    await write(tables, SCAN_A, VERDICT_A);
    const retry = await write(tables, SCAN_A, VERDICT_A);

    expect(retry.applied).toBe(true);
    expect(tables.repository_scan_state).toHaveLength(1);
    expect(state(tables).last_scan_id).toBe(SCAN_A);
    expect(state(tables).current_verdict_id).toBe(VERDICT_A);
  });

  it("C: B completed, then a duplicate A completion arrives -> no state change", async () => {
    const tables = world();
    await write(tables, SCAN_B, VERDICT_B);
    await write(tables, SCAN_A, VERDICT_A);
    await write(tables, SCAN_A, VERDICT_A);

    expect(state(tables).last_scan_id).toBe(SCAN_B);
    expect(state(tables).current_verdict_id).toBe(VERDICT_B);
  });

  it("D: the same scan written twice is idempotent", async () => {
    const tables = world();
    await write(tables, SCAN_B, VERDICT_B);
    const second = await write(tables, SCAN_B, VERDICT_B);

    expect(second.applied).toBe(true);
    expect(tables.repository_scan_state).toHaveLength(1);
    expect(state(tables).current_verdict_id).toBe(VERDICT_B);
  });

  it("E: a newer scan after an older one becomes and stays authoritative", async () => {
    const tables = world();
    await write(tables, SCAN_A, VERDICT_A);
    const newer = await write(tables, SCAN_B, VERDICT_B);
    const oldRetry = await write(tables, SCAN_A, VERDICT_A);

    expect(newer.applied).toBe(true);
    expect(oldRetry).toEqual({ applied: false, reason: "stale_writer" });
    expect(state(tables).last_scan_id).toBe(SCAN_B);
  });

  it("F: a pointer that changes between our read and our write is detected, not overwritten", async () => {
    // Scan B reads pointer=A, then (before its write lands) scan C, which is
    // newer than B, takes the pointer. B's compare-and-swap must not win.
    const tables = world({
      repository_scan_state: [
        { repository_id: PROJECT, organization_id: ORG, last_scan_id: SCAN_A, current_verdict_id: VERDICT_A },
      ],
    });
    const base = createFakeAdmin(tables);
    let stateReads = 0;
    const racyAdmin = {
      from(table: string) {
        const query = base.from(table);
        if (table === "repository_scan_state") {
          const originalMaybeSingle = query.maybeSingle.bind(query);
          query.maybeSingle = async () => {
            const result = await originalMaybeSingle();
            stateReads += 1;
            if (stateReads === 1) {
              tables.repository_scan_state![0].last_scan_id = SCAN_C;
              tables.repository_scan_state![0].current_verdict_id = "c0000000-0000-4000-8000-00000000000c";
            }
            return result;
          };
        }
        return query;
      },
    };

    const result = await writeScanStatePointer(racyAdmin as never, {
      organizationId: ORG,
      projectId: PROJECT,
      scanId: SCAN_B,
      values: pointer(SCAN_B, VERDICT_B),
    });

    expect(result).toEqual({ applied: false, reason: "stale_writer" });
    expect(state(tables).last_scan_id).toBe(SCAN_C);
    expect(state(tables).current_verdict_id).toBe("c0000000-0000-4000-8000-00000000000c");
  });
});

describe("writeScanStatePointer: identity and branch binding", () => {
  it("does not adopt a scan that belongs to a different project", async () => {
    const tables = world({
      scans: [{ id: SCAN_A, repository_id: OTHER_PROJECT, branch: "main", created_at: "2026-03-01T00:00:00.000Z" }],
    });
    expect(await write(tables, SCAN_A, VERDICT_A)).toEqual({ applied: false, reason: "scan_not_found" });
    expect(tables.repository_scan_state).toHaveLength(0);
  });

  it("does not adopt a scan id that does not exist", async () => {
    const tables = world({ scans: [] });
    expect(await write(tables, SCAN_A, VERDICT_A)).toEqual({ applied: false, reason: "scan_not_found" });
  });

  it("main READY, then a NEWER feature-branch scan: the main verdict stays current", async () => {
    const tables = world({
      scans: [
        { id: SCAN_A, repository_id: PROJECT, branch: "main", created_at: "2026-03-01T00:00:00.000Z" },
        { id: SCAN_B, repository_id: PROJECT, branch: "feature/x", created_at: "2026-03-02T00:00:00.000Z" },
      ],
    });
    await write(tables, SCAN_A, VERDICT_A);
    const feature = await write(tables, SCAN_B, VERDICT_B);

    expect(feature).toEqual({ applied: false, reason: "non_default_branch" });
    expect(state(tables).last_scan_id).toBe(SCAN_A);
    expect(state(tables).current_verdict_id).toBe(VERDICT_A);
  });

  it("a feature-branch scan never becomes the pointer even when nothing else exists", async () => {
    const tables = world({
      scans: [{ id: SCAN_B, repository_id: PROJECT, branch: "feature/x", created_at: "2026-03-02T00:00:00.000Z" }],
    });
    expect(await write(tables, SCAN_B, VERDICT_B)).toEqual({ applied: false, reason: "non_default_branch" });
    expect(tables.repository_scan_state).toHaveLength(0);
  });

  it("scans with no recorded branch keep the existing behavior (backward compatible)", async () => {
    const tables = world({
      scans: [{ id: SCAN_A, repository_id: PROJECT, branch: null, created_at: "2026-03-01T00:00:00.000Z" }],
    });
    expect((await write(tables, SCAN_A, VERDICT_A)).applied).toBe(true);
  });

  it("projects with no recorded default branch keep the existing behavior (backward compatible)", async () => {
    const tables = world({
      projects: [{ id: PROJECT, organization_id: ORG, github_default_branch: null }],
      scans: [{ id: SCAN_A, repository_id: PROJECT, branch: "feature/x", created_at: "2026-03-01T00:00:00.000Z" }],
    });
    expect((await write(tables, SCAN_A, VERDICT_A)).applied).toBe(true);
  });

  it("refuses to write active_scan_id through the pointer path", async () => {
    await expect(
      writeScanStatePointer(createFakeAdmin(world()) as never, {
        organizationId: ORG,
        projectId: PROJECT,
        scanId: SCAN_A,
        values: { active_scan_id: null },
      })
    ).rejects.toThrow(/active_scan_id/);
  });
});

describe("releaseActiveScan", () => {
  it("clears the marker only when it still belongs to the finishing scan", async () => {
    const tables = world({
      repository_scan_state: [{ repository_id: PROJECT, organization_id: ORG, active_scan_id: SCAN_B }],
    });
    // Scan A finishes while B is the one currently running.
    await releaseActiveScan(createFakeAdmin(tables) as never, { projectId: PROJECT, scanId: SCAN_A });
    expect(state(tables).active_scan_id).toBe(SCAN_B);

    await releaseActiveScan(createFakeAdmin(tables) as never, { projectId: PROJECT, scanId: SCAN_B });
    expect(state(tables).active_scan_id).toBeNull();
  });
});
