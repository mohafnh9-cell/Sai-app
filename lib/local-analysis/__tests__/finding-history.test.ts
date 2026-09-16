import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openLocalPersistenceStore, type LocalPersistenceStore, type SaveScanResultInput } from "../local-persistence";
import { buildFindingHistory, computeScanDelta, loadComparableScans } from "../finding-history";

const tempDirs: string[] = [];
const stores: LocalPersistenceStore[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

const WORKSPACE_ID = "ws-1";
const REPOSITORY_ID = "repo-1";

type FindingOverride = Partial<SaveScanResultInput["findings"][number]>;

function finding(overrides: FindingOverride = {}): SaveScanResultInput["findings"][number] {
  return {
    id: overrides.id ?? "f-default",
    title: overrides.title ?? "SQL injection",
    severity: overrides.severity ?? "high",
    category: overrides.category ?? "injection",
    rule_id: overrides.rule_id ?? "native:sql-injection",
    file_path: overrides.file_path ?? "app.ts",
    start_line: overrides.start_line ?? 10,
    recommendation: overrides.recommendation ?? "Use parameterized queries",
    confidence: overrides.confidence ?? "high",
    evidence: overrides.evidence ?? null,
    metadata: overrides.metadata ?? { correlationKey: overrides.rule_id ?? "native:sql-injection" },
  };
}

function saveScan(
  store: LocalPersistenceStore,
  input: {
    scanId: string;
    phase: "complete" | "partial" | "incomplete" | "cancelled";
    createdAt: string;
    findings: SaveScanResultInput["findings"];
    workspaceId?: string;
    repositoryId?: string;
  }
): void {
  const workspaceId = input.workspaceId ?? WORKSPACE_ID;
  const repositoryId = input.repositoryId ?? REPOSITORY_ID;
  store.saveScanResult({
    scan: {
      scanId: input.scanId,
      projectId: "proj-1",
      repositoryId,
      workspaceId,
      scope: "workspace",
      phase: input.phase,
      branch: "main",
      commitSha: "abc123",
      dirty: false,
      durationMs: 100,
      errorMessage: null,
      engines: [{ engine: "native", status: "COMPLETED", durationMs: 100, findingsCount: input.findings.length }],
      createdAt: input.createdAt,
      completedAt: input.createdAt,
    },
    findings: input.findings,
    verdict: {
      projectId: "proj-1",
      repositoryId,
      workspaceId,
      status: input.findings.length > 0 ? "not_ready" : "ready_to_ship",
      score: input.findings.length > 0 ? 40 : 100,
      blockersCount: input.findings.length,
      criticalBlockersCount: 0,
      highBlockersCount: input.findings.length,
      verdict: { status: "not_ready", score: 40 } as never,
    },
  });
}

function openStore(): LocalPersistenceStore {
  const root = makeTempDir("seq-history-");
  const store = openLocalPersistenceStore(root);
  stores.push(store);
  return store;
}

describe("finding-history: identity", () => {
  it("6 — a native finding's identity survives a line-number shift (correlationKey is line-independent)", () => {
    const store = openStore();
    const a = finding({ id: "f1", rule_id: "native:sql", start_line: 10, metadata: { correlationKey: "native:sql:app.ts" } });
    const aMoved = finding({ id: "f1", rule_id: "native:sql", start_line: 55, metadata: { correlationKey: "native:sql:app.ts" } });
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [a] });
    saveScan(store, { scanId: "s2", phase: "complete", createdAt: "2026-01-02T00:00:00.000Z", findings: [aMoved] });

    const history = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!;
    expect(history.delta.counts.persistingCount).toBe(1);
    expect(history.delta.counts.newCount).toBe(0);
    expect(history.delta.counts.resolvedCount).toBe(0);
  });
});

describe("finding-history: lifecycle (test matrix 1-9)", () => {
  it("1 — first scan: every finding is NEW", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [finding({ id: "f1" })] });

    const history = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!;
    expect(history.previousScan).toBeNull();
    expect(history.delta.counts.newCount).toBe(1);
    expect(history.delta.counts.persistingCount).toBe(0);
    expect(history.delta.counts.resolvedCount).toBe(0);
    expect(history.currentFindings[0]?.lifecycle).toBe("NEW");
  });

  it("2 — identical second scan: every finding is PERSISTING", () => {
    const store = openStore();
    const f = finding({ id: "f1" });
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [f] });
    saveScan(store, { scanId: "s2", phase: "complete", createdAt: "2026-01-02T00:00:00.000Z", findings: [f] });

    const history = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!;
    expect(history.delta.counts.persistingCount).toBe(1);
    expect(history.delta.counts.newCount).toBe(0);
    expect(history.currentFindings[0]?.lifecycle).toBe("PERSISTING");
  });

  it("3 — a finding disappears from a complete scan: RESOLVED", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [finding({ id: "f1" })] });
    saveScan(store, { scanId: "s2", phase: "complete", createdAt: "2026-01-02T00:00:00.000Z", findings: [] });

    const history = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!;
    expect(history.delta.counts.resolvedCount).toBe(1);
    expect(history.delta.resolvedFindings[0]?.ruleId).toBe("native:sql-injection");
    expect(history.delta.counts.lifecycleUnknownCount).toBe(0);
  });

  it("4 — a new finding appears: NEW", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [] });
    saveScan(store, { scanId: "s2", phase: "complete", createdAt: "2026-01-02T00:00:00.000Z", findings: [finding({ id: "f1" })] });

    const history = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!;
    expect(history.delta.counts.newCount).toBe(1);
    expect(history.currentFindings[0]?.lifecycle).toBe("NEW");
  });

  it("5 — one new + one persisting + one resolved in a single delta", () => {
    const store = openStore();
    const persisting = finding({ id: "f1", rule_id: "native:a", metadata: { correlationKey: "a" } });
    const resolved = finding({ id: "f2", rule_id: "native:b", metadata: { correlationKey: "b" } });
    const brandNew = finding({ id: "f3", rule_id: "native:c", metadata: { correlationKey: "c" } });
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [persisting, resolved] });
    saveScan(store, { scanId: "s2", phase: "complete", createdAt: "2026-01-02T00:00:00.000Z", findings: [persisting, brandNew] });

    const history = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!;
    expect(history.delta.counts).toEqual({ newCount: 1, persistingCount: 1, resolvedCount: 1, lifecycleUnknownCount: 0 });
  });

  it("6 — zero findings in a COMPLETE scan resolves all prior findings", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [finding({ id: "f1" })] });
    saveScan(store, { scanId: "s2", phase: "complete", createdAt: "2026-01-02T00:00:00.000Z", findings: [] });

    const delta = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!.delta;
    expect(delta.resolvedFindings).toHaveLength(1);
  });

  it("7 — zero findings in a PARTIAL scan does NOT resolve prior findings", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [finding({ id: "f1" })] });
    saveScan(store, { scanId: "s2", phase: "partial", createdAt: "2026-01-02T00:00:00.000Z", findings: [] });

    const delta = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!.delta;
    expect(delta.resolvedFindings).toHaveLength(0);
    expect(delta.lifecycleUnknownFindings).toHaveLength(1);
    expect(delta.currentScanComplete).toBe(false);
  });

  it("8 — a scan recorded as incomplete does NOT resolve prior findings", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [finding({ id: "f1" })] });
    saveScan(store, { scanId: "s2", phase: "incomplete", createdAt: "2026-01-02T00:00:00.000Z", findings: [] });

    const delta = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!.delta;
    expect(delta.resolvedFindings).toHaveLength(0);
    expect(delta.lifecycleUnknownFindings).toHaveLength(1);
  });

  it("9 — a scan recorded as cancelled does NOT resolve prior findings", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [finding({ id: "f1" })] });
    saveScan(store, { scanId: "s2", phase: "cancelled", createdAt: "2026-01-02T00:00:00.000Z", findings: [] });

    const delta = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!.delta;
    expect(delta.resolvedFindings).toHaveLength(0);
    expect(delta.lifecycleUnknownFindings).toHaveLength(1);
  });
});

describe("finding-history: isolation", () => {
  it("10/11 — scans from another repository or workspace are never compared", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [finding({ id: "f1" })] });
    // Same physical store, but a different repository/workspace -- must never be pulled into the comparison window.
    saveScan(store, {
      scanId: "s2",
      phase: "complete",
      createdAt: "2026-01-02T00:00:00.000Z",
      findings: [],
      repositoryId: "repo-other",
      workspaceId: "ws-other",
    });

    const scans = loadComparableScans(store, WORKSPACE_ID, REPOSITORY_ID);
    expect(scans).toHaveLength(1);
    expect(scans[0]?.scanId).toBe("s1");

    const history = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!;
    expect(history.previousScan).toBeNull();
    expect(history.currentFindings[0]?.lifecycle).toBe("NEW");
  });
});

describe("finding-history: severity changes", () => {
  it("14 — a severity change on the same identity is PERSISTING, not NEW, with severityChanged exposed", () => {
    const store = openStore();
    const low = finding({ id: "f1", rule_id: "native:x", severity: "high", metadata: { correlationKey: "x" } });
    const high = finding({ id: "f1", rule_id: "native:x", severity: "critical", metadata: { correlationKey: "x" } });
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [low] });
    saveScan(store, { scanId: "s2", phase: "complete", createdAt: "2026-01-02T00:00:00.000Z", findings: [high] });

    const history = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!;
    expect(history.delta.counts.newCount).toBe(0);
    expect(history.delta.counts.persistingCount).toBe(1);
    const entry = history.currentFindings[0]!;
    expect(entry.lifecycle).toBe("PERSISTING");
    expect(entry.severityChanged).toBe(true);
    expect(entry.previousSeverity).toBe("high");
    expect(entry.severity).toBe("critical");
  });
});

describe("finding-history: ordering and immutability", () => {
  it("15 — currentFindings is deterministically ordered by correlationKey", () => {
    const store = openStore();
    const findings = [
      finding({ id: "f-z", rule_id: "native:z", metadata: { correlationKey: "z" } }),
      finding({ id: "f-a", rule_id: "native:a", metadata: { correlationKey: "a" } }),
      finding({ id: "f-m", rule_id: "native:m", metadata: { correlationKey: "m" } }),
    ];
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings });

    const history = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!;
    const keys = history.currentFindings.map((f) => f.correlationKey);
    expect(keys).toEqual([...keys].sort());
  });

  it("16 — a second read of history never mutates the persisted scan rows", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [finding({ id: "f1" })] });
    saveScan(store, { scanId: "s2", phase: "complete", createdAt: "2026-01-02T00:00:00.000Z", findings: [] });

    buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID });
    buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID });

    expect(store.getScan("s1")?.phase).toBe("complete");
    expect(store.getFindingsForScan("s1")).toHaveLength(1);
  });
});

describe("finding-history: firstSeen/lastSeen", () => {
  it("17 — firstSeen is the earliest scan a finding was observed in; lastSeen tracks the latest", () => {
    const store = openStore();
    const f = finding({ id: "f1", rule_id: "native:x", metadata: { correlationKey: "x" } });
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [f] });
    saveScan(store, { scanId: "s2", phase: "complete", createdAt: "2026-01-02T00:00:00.000Z", findings: [f] });
    saveScan(store, { scanId: "s3", phase: "complete", createdAt: "2026-01-03T00:00:00.000Z", findings: [f] });

    const history = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!;
    const entry = history.currentFindings[0]!;
    expect(entry.firstSeenScanId).toBe("s1");
    expect(entry.lastSeenScanId).toBe("s3");
  });
});

describe("finding-history: verdict history", () => {
  it("18/19 — latest and previous verdict are retrievable, with a status-change flag", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", createdAt: "2026-01-01T00:00:00.000Z", findings: [finding({ id: "f1" })] });
    saveScan(store, { scanId: "s2", phase: "complete", createdAt: "2026-01-02T00:00:00.000Z", findings: [] });

    const history = buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })!;
    expect(history.verdictHistory.latest?.status).toBe("ready_to_ship");
    expect(history.verdictHistory.previous?.status).toBe("not_ready");
    expect(history.verdictHistory.statusChanged).toBe(true);
  });
});

describe("finding-history: no persisted history", () => {
  it("returns null when nothing has been persisted for this workspace/repository", () => {
    const store = openStore();
    expect(buildFindingHistory(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID })).toBeNull();
  });
});

describe("computeScanDelta: direct unit coverage", () => {
  it("treats a null previous scan as 'everything is new'", () => {
    const scan = { scanId: "s1", projectId: "p", repositoryId: REPOSITORY_ID, workspaceId: WORKSPACE_ID, scope: "workspace", phase: "complete" as const, branch: null, commitSha: null, dirty: false, durationMs: 1, errorMessage: null, engines: [], createdAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.000Z" };
    const delta = computeScanDelta({
      workspaceId: WORKSPACE_ID,
      previous: null,
      current: { scan, findings: [{ id: "f1", scanId: "s1", title: "X", rule_id: "native:x", file_path: "a.ts", severity: "high", metadata: { correlationKey: "x" } }] },
    });
    expect(delta.counts).toEqual({ newCount: 1, persistingCount: 0, resolvedCount: 0, lifecycleUnknownCount: 0 });
  });
});
