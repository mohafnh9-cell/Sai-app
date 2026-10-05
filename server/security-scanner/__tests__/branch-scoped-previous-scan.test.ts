import { describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

vi.mock("server-only", () => ({}));

import { InlineScanJobRunner } from "../scan-job-runner";
import { findPreviousCompletedScan, listPreviousCompletedScans } from "../previous-scan";
import { releaseActiveScan, writeScanStatePointer } from "@/server/production-verdict/scan-state-writer";

/**
 * Phase 7E: a scan's baseline (carried-forward findings, inherited coverage,
 * verdict deltas) must come from the SAME branch, or -- only for a branch's
 * first scan -- the default branch. Never from another feature branch merely
 * because it was the most recent scan of the repository.
 */
const ORG = "org-1";
const PROJECT = "11111111-1111-4111-8111-111111111111";

type ScanSpec = { id: string; branch: string | null; at: string; status?: string };

function scanRow(s: ScanSpec) {
  return {
    id: s.id,
    project_id: PROJECT,
    repository_id: PROJECT,
    status: s.status ?? "completed",
    branch: s.branch,
    completed_at: s.at,
    created_at: s.at,
    files_analyzed: 10,
    files_discovered: 12,
  };
}

function findingRow(scanId: string, rule: string, path: string) {
  return {
    scan_id: scanId,
    status: "open",
    rule_id: rule,
    severity: "high",
    category: "web",
    title: `${rule} in ${path}`,
    description: "d",
    confidence: "high",
    file_path: path,
    start_line: 3,
    evidence: "e",
    recommendation: "r",
    metadata: {},
    fingerprint: `fp:${rule}:${path}`,
  };
}

function world(scans: ScanSpec[], findings: ReturnType<typeof findingRow>[] = [], defaultBranch: string | null = "main"): FakeTables {
  return {
    projects: [{ id: PROJECT, organization_id: ORG, github_default_branch: defaultBranch }],
    scans: scans.map(scanRow),
    scan_findings: findings,
  } as FakeTables;
}

const scope = (branch: string | null, excludeScanId = "current") => ({ projectId: PROJECT, branch, excludeScanId });
const previousId = async (tables: FakeTables, branch: string | null) =>
  (await findPreviousCompletedScan(createFakeAdmin(tables) as never, scope(branch), "id"))?.id ?? null;

describe("previous-scan baseline resolution", () => {
  it("TEST A: branch B does not use branch A's scan just because A is the most recent repository scan", async () => {
    const t = world([
      { id: "main-1", branch: "main", at: "2026-01-01T00:00:00Z" },
      { id: "a-1", branch: "branch-a", at: "2026-01-02T00:00:00Z" },
    ]);
    expect(await previousId(t, "branch-b")).toBe("main-1"); // explicit default fallback, NOT a-1
  });

  it("TEST A': with no default-branch scan either, branch B has no baseline (never branch A)", async () => {
    const t = world([{ id: "a-1", branch: "branch-a", at: "2026-01-02T00:00:00Z" }]);
    expect(await previousId(t, "branch-b")).toBeNull();
  });

  it("TEST B: B -> C -> B resolves B's own previous scan, not C's", async () => {
    const t = world([
      { id: "main-1", branch: "main", at: "2026-01-01T00:00:00Z" },
      { id: "b-1", branch: "branch-b", at: "2026-01-02T00:00:00Z" },
      { id: "c-1", branch: "branch-c", at: "2026-01-03T00:00:00Z" },
    ]);
    expect(await previousId(t, "branch-b")).toBe("b-1");
  });

  it("TEST C: a feature branch with no own scan falls back to the default branch only; the default branch ignores feature scans", async () => {
    const t = world([
      { id: "main-1", branch: "main", at: "2026-01-01T00:00:00Z" },
      { id: "f-1", branch: "feature/x", at: "2026-01-05T00:00:00Z" },
    ]);
    expect(await previousId(t, "feature/y")).toBe("main-1");
    expect(await previousId(t, "main")).toBe("main-1");
  });

  it("a branch's own scan wins over the default branch even if the default scan is newer", async () => {
    const t = world([
      { id: "f-1", branch: "feature/x", at: "2026-01-01T00:00:00Z" },
      { id: "main-1", branch: "main", at: "2026-01-09T00:00:00Z" },
    ]);
    expect(await previousId(t, "feature/x")).toBe("f-1");
  });

  it("legacy scans without a branch count as the default branch (and are not used by feature branches' own lookup)", async () => {
    const t = world([{ id: "legacy-1", branch: null, at: "2026-01-01T00:00:00Z" }]);
    expect(await previousId(t, null)).toBe("legacy-1");
    expect(await previousId(t, "main")).toBe("legacy-1");
  });

  it("an unknown default branch means no fallback at all (conservative)", async () => {
    const t = world([{ id: "main-1", branch: "main", at: "2026-01-01T00:00:00Z" }], [], null);
    expect(await previousId(t, "feature/x")).toBeNull();
  });

  it("only completed scans are baselines, and the scan itself is excluded", async () => {
    const t = world([
      { id: "b-run", branch: "branch-b", at: "2026-01-03T00:00:00Z", status: "running" },
      { id: "b-1", branch: "branch-b", at: "2026-01-02T00:00:00Z" },
      { id: "current", branch: "branch-b", at: "2026-01-04T00:00:00Z" },
    ]);
    expect(await previousId(t, "branch-b")).toBe("b-1");
  });

  it("coverage lookup lists same-branch scans before the default-branch fallback and never another feature branch", async () => {
    const t = world([
      { id: "main-1", branch: "main", at: "2026-01-01T00:00:00Z" },
      { id: "a-1", branch: "branch-a", at: "2026-01-02T00:00:00Z" },
      { id: "b-1", branch: "branch-b", at: "2026-01-03T00:00:00Z" },
    ]);
    const rows = await listPreviousCompletedScans(createFakeAdmin(t) as never, scope("branch-b"), "id", 8);
    expect(rows.map((r) => r.id)).toEqual(["b-1", "main-1"]);
  });
});

describe("InlineScanJobRunner.mergeIncrementalFindings carries findings forward per branch", () => {
  const merge = async (tables: FakeTables, branch: string, changedPaths: string[] = ["docs/readme.md"]) => {
    const runner = new InlineScanJobRunner(createFakeAdmin(tables) as never) as unknown as {
      mergeIncrementalFindings: (
        ctx: Record<string, unknown>,
        changed: string[],
        found: unknown[]
      ) => Promise<{ findings: Array<{ ruleId: string; location: { path: string } }> }>;
    };
    return runner.mergeIncrementalFindings(
      { scanId: "current", repositoryId: PROJECT, organizationId: ORG, branch },
      changedPaths,
      []
    );
  };
  const paths = (r: { findings: Array<{ location: { path: string } }> }) => r.findings.map((f) => f.location.path).sort();

  it("TEST A (regression of the Phase 7D defect): branch B must not inherit branch A's findings", async () => {
    const t = world(
      [
        { id: "main-1", branch: "main", at: "2026-01-01T00:00:00Z" },
        { id: "a-1", branch: "branch-a", at: "2026-01-02T00:00:00Z" },
      ],
      [findingRow("a-1", "auth.insecure-cookie", "src/only-on-a.js"), findingRow("main-1", "web.permissive-cors", "src/server.js")]
    );
    const merged = await merge(t, "branch-b");
    expect(paths(merged)).toEqual(["src/server.js"]); // the default branch's unchanged file, never A's
    expect(paths(merged)).not.toContain("src/only-on-a.js");
  });

  it("TEST B: B scanned, then C, then B again: B inherits only B's findings", async () => {
    const t = world(
      [
        { id: "main-1", branch: "main", at: "2026-01-01T00:00:00Z" },
        { id: "b-1", branch: "branch-b", at: "2026-01-02T00:00:00Z" },
        { id: "c-1", branch: "branch-c", at: "2026-01-03T00:00:00Z" },
      ],
      [findingRow("b-1", "rule.y", "src/y.js"), findingRow("c-1", "rule.c", "src/c.js")]
    );
    expect(paths(await merge(t, "branch-b"))).toEqual(["src/y.js"]);
  });

  it("TEST C: the default branch's finding reaches a feature branch's first scan only through the explicit fallback, and only for unchanged files", async () => {
    const t = world(
      [{ id: "main-1", branch: "main", at: "2026-01-01T00:00:00Z" }],
      [findingRow("main-1", "rule.x", "src/x.js"), findingRow("main-1", "rule.z", "src/z.js")]
    );
    // src/z.js is rewritten on the feature branch, so its old finding is not carried over.
    expect(paths(await merge(t, "feature/new", ["src/z.js"]))).toEqual(["src/x.js"]);
  });

  it("TEST E: same-branch carry-forward still preserves legitimate open findings of unchanged files", async () => {
    const t = world(
      [
        { id: "main-1", branch: "main", at: "2026-01-01T00:00:00Z" },
        { id: "f-1", branch: "feature/x", at: "2026-01-02T00:00:00Z" },
      ],
      [
        findingRow("f-1", "auth.insecure-cookie", "src/cookie.js"),
        findingRow("f-1", "web.permissive-cors", "src/app.js"),
        findingRow("main-1", "rule.main-only", "src/main-only.js"),
      ]
    );
    // src/app.js was fixed in this commit (changed) -> not carried; cookie.js unchanged -> carried; main's is not mixed in.
    expect(paths(await merge(t, "feature/x", ["src/app.js"]))).toEqual(["src/cookie.js"]);
  });
});

describe("TEST D: feature-branch scans never move the default branch's authoritative state", () => {
  it("pointer writes and active-scan release for a feature-branch scan leave every authoritative field untouched", async () => {
    const tables = {
      projects: [{ id: PROJECT, organization_id: ORG, github_default_branch: "main", github_last_commit_sha: "main-head", last_scan_at: "2026-01-01T00:00:00Z" }],
      scans: [
        scanRow({ id: "main-1", branch: "main", at: "2026-01-01T00:00:00Z" }),
        scanRow({ id: "f-1", branch: "feature/x", at: "2026-01-09T00:00:00Z" }),
      ],
      repository_scan_state: [
        { repository_id: PROJECT, organization_id: ORG, last_scan_id: "main-1", current_verdict_id: "v-main", last_commit_sha: "main-head", last_full_scan_at: "2026-01-01T00:00:00Z", active_scan_id: null },
      ],
    } as unknown as FakeTables;
    const before = JSON.stringify([tables.projects, tables.repository_scan_state]);

    const result = await writeScanStatePointer(createFakeAdmin(tables) as never, {
      organizationId: ORG,
      projectId: PROJECT,
      scanId: "f-1",
      values: { last_scan_id: "f-1", current_verdict_id: "v-feature", last_commit_sha: "feature-head", last_full_scan_at: "2026-01-09T00:00:00Z" },
    });
    await releaseActiveScan(createFakeAdmin(tables) as never, { projectId: PROJECT, scanId: "f-1" });

    expect(result).toEqual({ applied: false, reason: "non_default_branch" });
    expect(JSON.stringify([tables.projects, tables.repository_scan_state])).toBe(before);
  });
});
