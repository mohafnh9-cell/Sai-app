import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { findPreviousCompletedScan } from "../previous-scan";

/** Records the filters applied to `scans`, like PostgREST would receive them. */
function recordingAdmin(rows: Array<Record<string, unknown>>) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "is", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  const admin = {
    from: (table: string) => {
      if (table === "projects") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { github_default_branch: "main" } }) }) }) };
      }
      return builder;
    },
  };
  return { admin: admin as never, calls };
}

describe("previous-scan exclusion", () => {
  it("an empty excludeScanId excludes nothing: no invalid uuid comparison is sent (it made the lookup silently return no rows in production)", async () => {
    const { admin, calls } = recordingAdmin([{ id: "s1" }]);
    const row = await findPreviousCompletedScan(admin, { projectId: "p", branch: null, excludeScanId: "" }, "id");
    expect(row).toMatchObject({ id: "s1" });
    expect(calls.filter(([m]) => m === "neq")).toEqual([]);
  });

  it("a real scan id is still excluded", async () => {
    const { admin, calls } = recordingAdmin([{ id: "s1" }]);
    await findPreviousCompletedScan(admin, { projectId: "p", branch: null, excludeScanId: "scan-x" }, "id");
    expect(calls).toContainEqual(["neq", "id", "scan-x"]);
  });
});
