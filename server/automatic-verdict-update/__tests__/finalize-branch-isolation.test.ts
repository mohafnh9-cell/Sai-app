import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const generate = vi.fn();
vi.mock("@/server/production-verdict/service", () => ({
  generateAndPersistProductionVerdict: (...a: unknown[]) => generate(...a),
  getProductionVerdictByScan: async () => null,
}));

import { finalizeProjectStateAfterAutomaticReview } from "../finalize";

function makeAdmin(scanBranch: string) {
  const writes: Array<{ table: string; op: string }> = [];
  const scan = {
    id: "s1",
    status: "completed",
    review_type: "automatic",
    branch: scanBranch,
    commit_sha: "abc",
    security_score: 100,
    findings_count: 0,
    completed_at: "2026-01-01T00:00:00Z",
  };
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.maybeSingle = async () =>
        table === "scans" ? { data: scan, error: null } : { data: { github_default_branch: "main" }, error: null };
      chain.update = () => {
        writes.push({ table, op: "update" });
        return chain;
      };
      chain.upsert = async () => {
        writes.push({ table, op: "upsert" });
        return { error: null };
      };
      chain.then = (r: (v: unknown) => unknown) => r({ error: null });
      return chain;
    },
  };
  return { admin: admin as never, writes };
}

describe("automatic review finalize branch isolation", () => {
  beforeEach(() => generate.mockReset().mockResolvedValue({ status: "ready_to_ship", score: 100 }));

  it("does not move project score or scan-state pointers for a feature branch", async () => {
    const { admin, writes } = makeAdmin("feature/x");
    await finalizeProjectStateAfterAutomaticReview(admin, { organizationId: "o", projectId: "p", scanId: "s1" });
    expect(writes.filter((w) => w.table === "repository_scan_state" || w.table === "projects")).toEqual([]);
    expect(generate).toHaveBeenCalled();
  });

  it("moves them for the default branch", async () => {
    const { admin, writes } = makeAdmin("main");
    await finalizeProjectStateAfterAutomaticReview(admin, { organizationId: "o", projectId: "p", scanId: "s1" });
    expect(writes.map((w) => w.table)).toEqual(expect.arrayContaining(["repository_scan_state", "projects"]));
  });
});
