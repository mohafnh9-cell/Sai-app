import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { newerScanAwaitingVerdict, VERDICT_MATERIALIZATION_WINDOW_MS } from "../pending-verdict";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "99999999-9999-4999-8999-999999999999";
const OLD = "22222222-2222-4222-8222-222222222222";
const NEW = "33333333-3333-4333-8333-333333333333";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const scan = (over: Record<string, unknown> = {}) => ({
  id: NEW, project_id: PROJECT, repository_id: PROJECT, branch: "main", status: "completed", completed_at: ago(10_000), ...over,
});

function admin(scans: Array<Record<string, unknown>>) {
  return createFakeAdmin({
    projects: [{ id: PROJECT, github_default_branch: "main" }],
    scans,
  } as unknown as FakeTables) as never;
}

describe("newerScanAwaitingVerdict", () => {
  it("true: the latest completed default-branch scan is newer than the verdict's scan and inside the window", async () => {
    expect(await newerScanAwaitingVerdict(admin([scan()]), PROJECT, OLD)).toBe(true);
  });

  it("false: the verdict already belongs to the latest scan", async () => {
    expect(await newerScanAwaitingVerdict(admin([scan({ id: OLD })]), PROJECT, OLD)).toBe(false);
  });

  it("false after the window (a verdict that never arrives is not an endless in-progress state)", async () => {
    const stale = scan({ completed_at: ago(VERDICT_MATERIALIZATION_WINDOW_MS + 5_000) });
    expect(await newerScanAwaitingVerdict(admin([stale]), PROJECT, OLD)).toBe(false);
  });

  it("false for failed / cancelled / running newer scans (not completed)", async () => {
    for (const status of ["failed", "cancelled", "running", "queued"]) {
      expect(await newerScanAwaitingVerdict(admin([scan({ status, completed_at: null })]), PROJECT, OLD)).toBe(false);
    }
  });

  it("false for a feature-branch scan (the verdict is tied to its branch) and for another project's scan", async () => {
    expect(await newerScanAwaitingVerdict(admin([scan({ branch: "feature/x" })]), PROJECT, OLD)).toBe(false);
    expect(await newerScanAwaitingVerdict(admin([scan({ project_id: OTHER_PROJECT, repository_id: OTHER_PROJECT })]), PROJECT, OLD)).toBe(false);
  });

  it("false without a current verdict scan id (no verdict is handled by the no-verdict states)", async () => {
    expect(await newerScanAwaitingVerdict(admin([scan()]), PROJECT, null)).toBe(false);
  });

  it("a failed lookup is not an in-progress claim", async () => {
    expect(await newerScanAwaitingVerdict({} as never, PROJECT, OLD)).toBe(false);
  });
});
