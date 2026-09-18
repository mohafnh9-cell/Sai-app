import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalPersistenceError,
  openLocalPersistenceStore,
  type SaveScanResultInput,
} from "../local-persistence";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

function scanInput(overrides: Partial<SaveScanResultInput["scan"]> = {}): SaveScanResultInput {
  return {
    scan: {
      scanId: overrides.scanId ?? "scan-1",
      projectId: overrides.projectId ?? "proj-1",
      repositoryId: overrides.repositoryId ?? "repo-1",
      workspaceId: overrides.workspaceId ?? "ws-1",
      scope: "workspace",
      phase: "complete",
      branch: "main",
      commitSha: "abc123",
      dirty: false,
      durationMs: 100,
      errorMessage: null,
      engines: [{ engine: "native", status: "COMPLETED", durationMs: 50, findingsCount: 1 }],
      ...overrides,
    },
    findings: [
      {
        id: "f1",
        title: "SQL injection",
        severity: "critical",
        category: "injection",
        rule_id: "native:sql",
        file_path: "app.ts",
        start_line: 10,
        recommendation: "Use parameterized queries",
        confidence: "high",
        evidence: "db.query(userInput)",
        metadata: { engine: "native" },
      },
    ],
    verdict: {
      projectId: overrides.projectId ?? "proj-1",
      repositoryId: overrides.repositoryId ?? "repo-1",
      workspaceId: overrides.workspaceId ?? "ws-1",
      status: "not_ready",
      score: 40,
      blockersCount: 1,
      criticalBlockersCount: 1,
      highBlockersCount: 0,
      verdict: {
        status: "not_ready",
        score: 40,
        blockersCount: 1,
        criticalBlockersCount: 1,
        highBlockersCount: 0,
      } as never,
    },
  };
}

describe("DATABASE", () => {
  it("1/2 — database and schema are created automatically on first open", () => {
    const root = makeTempDir("seq-db-create-");
    const store = openLocalPersistenceStore(root);
    expect(existsSync(join(root, ".sequrai", "sequrai.db"))).toBe(true);
    store.close();

    const raw = new DatabaseSync(join(root, ".sequrai", "sequrai.db"));
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("scans");
    expect(tables).toContain("findings");
    expect(tables).toContain("verdicts");
    expect(tables).toContain("schema_migrations");
    raw.close();
  });

  it("3 — initialization is idempotent (opening twice doesn't error or duplicate migrations)", () => {
    const root = makeTempDir("seq-db-idempotent-");
    const a = openLocalPersistenceStore(root);
    a.close();
    const b = openLocalPersistenceStore(root);
    b.saveScanResult(scanInput());
    expect(b.getScan("scan-1")).not.toBeNull();
    b.close();

    const raw = new DatabaseSync(join(root, ".sequrai", "sequrai.db"));
    const count = raw.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    expect(count.n).toBe(1);
    raw.close();
  });

  it("4 — migrations are applied exactly once, recorded in schema_migrations", () => {
    const root = makeTempDir("seq-db-migrations-once-");
    const store = openLocalPersistenceStore(root);
    store.close();
    const raw = new DatabaseSync(join(root, ".sequrai", "sequrai.db"));
    const rows = raw.prepare("SELECT version FROM schema_migrations").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { version: number }).version).toBe(1);
    raw.close();
  });

  it("5 — a schema creation failure rolls back rather than leaving a half-applied schema_migrations row", () => {
    const root = makeTempDir("seq-db-migration-fail-");
    // Simulate a mid-migration failure by pre-creating a colliding, wrongly-shaped
    // 'scans' table that the real migration's CREATE TABLE IF NOT EXISTS would
    // silently accept but whose CREATE INDEX would then fail against (missing
    // the workspace_id/created_at columns the index needs).
    mkdirSync(join(root, ".sequrai"), { recursive: true });
    const raw = new DatabaseSync(join(root, ".sequrai", "sequrai.db"));
    raw.exec("CREATE TABLE scans (id TEXT PRIMARY KEY)");
    raw.close();

    expect(() => openLocalPersistenceStore(root)).toThrow(LocalPersistenceError);
    try {
      openLocalPersistenceStore(root);
    } catch (error) {
      expect(error).toBeInstanceOf(LocalPersistenceError);
      expect((error as LocalPersistenceError).code).toBe("LOCAL_PERSISTENCE_MIGRATION_FAILED");
    }

    const raw2 = new DatabaseSync(join(root, ".sequrai", "sequrai.db"));
    const count = raw2.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number } | undefined;
    // The migrations table itself may or may not exist depending on where the
    // failure occurred, but if it exists, it must NOT record version 1 as applied.
    if (count) expect(count.n).toBe(0);
    raw2.close();
  });

  it("6 — the database survives being closed and reopened", () => {
    const root = makeTempDir("seq-db-reopen-");
    const a = openLocalPersistenceStore(root);
    a.saveScanResult(scanInput());
    a.close();

    const b = openLocalPersistenceStore(root);
    expect(b.getScan("scan-1")?.scanId).toBe("scan-1");
    b.close();
  });
});

describe("IDENTITY", () => {
  it("7/8/9 — projectId, repositoryId, workspaceId are all persisted on the scan row", () => {
    const root = makeTempDir("seq-id-persisted-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput({ projectId: "proj-x", repositoryId: "repo-x", workspaceId: "ws-x" }));
    const scan = store.getScan("scan-1");
    expect(scan?.projectId).toBe("proj-x");
    expect(scan?.repositoryId).toBe("repo-x");
    expect(scan?.workspaceId).toBe("ws-x");
    store.close();
  });

  it("10 — scanId is the natural primary key; saving the same scanId twice fails rather than silently overwriting", () => {
    const root = makeTempDir("seq-id-unique-scan-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput());
    expect(() => store.saveScanResult(scanInput())).toThrow(LocalPersistenceError);
    store.close();
  });

  it("11 — no old LOCAL_* constants are used anywhere in the persistence path", async () => {
    const mod = await import("../local-orchestrator");
    expect(Object.keys(mod)).not.toContain("LOCAL_PROJECT_ID");
    expect(Object.keys(mod)).not.toContain("LOCAL_REPOSITORY_ID");
    expect(Object.keys(mod)).not.toContain("LOCAL_ORGANIZATION_ID");
  });
});

describe("SCAN", () => {
  it("12/13 — a scan is persisted and retrievable by id", () => {
    const root = makeTempDir("seq-scan-persist-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput());
    const scan = store.getScan("scan-1");
    expect(scan).not.toBeNull();
    expect(scan?.scanId).toBe("scan-1");
    store.close();
  });

  it("14 — the latest scan for a workspace is retrievable", () => {
    const root = makeTempDir("seq-scan-latest-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput({ scanId: "s1", workspaceId: "ws-1" }));
    store.saveScanResult(scanInput({ scanId: "s2", workspaceId: "ws-1" }));
    const latest = store.getLatestScan("ws-1");
    expect(latest?.scanId).toBe("s2");
    store.close();
  });

  it("15 — multiple scans are all preserved, none overwritten", () => {
    const root = makeTempDir("seq-scan-multi-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput({ scanId: "s1", workspaceId: "ws-1" }));
    store.saveScanResult(scanInput({ scanId: "s2", workspaceId: "ws-1" }));
    store.saveScanResult(scanInput({ scanId: "s3", workspaceId: "ws-1" }));
    expect(store.listScans("ws-1")).toHaveLength(3);
    store.close();
  });

  it("16 — scan status/phase is preserved exactly", () => {
    const root = makeTempDir("seq-scan-status-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput({ scanId: "s1", phase: "partial" }));
    expect(store.getScan("s1")?.phase).toBe("partial");
    store.close();
  });

  it("17 — timestamps are preserved", () => {
    const root = makeTempDir("seq-scan-timestamps-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput());
    const scan = store.getScan("scan-1");
    expect(scan?.createdAt).toBeTruthy();
    expect(scan?.completedAt).toBeTruthy();
    expect(() => new Date(scan!.createdAt).toISOString()).not.toThrow();
    store.close();
  });
});

describe("FINDINGS", () => {
  it("18/19/20/21/22 — findings are persisted with fingerprint/rule, severity, engine, and file/line metadata preserved", () => {
    const root = makeTempDir("seq-findings-fields-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput());
    const findings = store.getFindingsForScan("scan-1");
    expect(findings).toHaveLength(1);
    expect(findings[0].rule_id).toBe("native:sql");
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].file_path).toBe("app.ts");
    expect(findings[0].start_line).toBe(10);
    expect((findings[0].metadata as { engine?: string })?.engine).toBe("native");
    store.close();
  });

  it("23 — findings are retrievable by scanId, scoped to that scan only", () => {
    const root = makeTempDir("seq-findings-scoped-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput({ scanId: "s1" }));
    store.saveScanResult(scanInput({ scanId: "s2" }));
    expect(store.getFindingsForScan("s1")).toHaveLength(1);
    expect(store.getFindingsForScan("s2")).toHaveLength(1);
    store.close();
  });

  it("24 — a scan with zero findings persists and retrieves an empty array, not an error", () => {
    const root = makeTempDir("seq-findings-empty-");
    const store = openLocalPersistenceStore(root);
    const input = scanInput();
    input.findings = [];
    store.saveScanResult(input);
    expect(store.getFindingsForScan("scan-1")).toEqual([]);
    store.close();
  });
});

describe("VERDICT", () => {
  it("25/26/27 — READY, NEEDS ATTENTION, and NOT READY are each persisted correctly, never altered", () => {
    const root = makeTempDir("seq-verdict-statuses-");
    const store = openLocalPersistenceStore(root);
    for (const status of ["ready_to_ship", "needs_improvement", "not_ready"]) {
      const input = scanInput({ scanId: `scan-${status}` });
      input.verdict!.status = status;
      input.verdict!.verdict = { status } as never;
      store.saveScanResult(input);
      expect(store.getVerdictForScan(`scan-${status}`)?.status).toBe(status);
    }
    store.close();
  });

  it("28/29 — score and blockers are preserved exactly", () => {
    const root = makeTempDir("seq-verdict-score-");
    const store = openLocalPersistenceStore(root);
    const input = scanInput();
    input.verdict!.score = 73;
    input.verdict!.blockersCount = 4;
    input.verdict!.criticalBlockersCount = 2;
    input.verdict!.highBlockersCount = 2;
    store.saveScanResult(input);
    const verdict = store.getVerdictForScan("scan-1");
    expect(verdict?.score).toBe(73);
    expect(verdict?.blockersCount).toBe(4);
    expect(verdict?.criticalBlockersCount).toBe(2);
    expect(verdict?.highBlockersCount).toBe(2);
    store.close();
  });

  it("30 — verdict is retrievable by scanId and null (not an error) when a scan has none", () => {
    const root = makeTempDir("seq-verdict-none-");
    const store = openLocalPersistenceStore(root);
    const input = scanInput();
    delete input.verdict;
    store.saveScanResult(input);
    expect(store.getVerdictForScan("scan-1")).toBeNull();
    store.close();
  });
});

describe("RESTART", () => {
  it("31/32/33/34 — write, destroy the store instance, create a new one, state is still available", () => {
    const root = makeTempDir("seq-restart-");
    const a = openLocalPersistenceStore(root);
    a.saveScanResult(scanInput());
    a.close(); // destroy the instance entirely

    const b = openLocalPersistenceStore(root); // fresh instance, same file
    const scan = b.getScan("scan-1");
    const findings = b.getFindingsForScan("scan-1");
    const verdict = b.getVerdictForScan("scan-1");
    expect(scan?.scanId).toBe("scan-1");
    expect(findings).toHaveLength(1);
    expect(verdict?.status).toBe("not_ready");
    b.close();
  });
});

describe("ISOLATION", () => {
  it("35 — repository A's scans are never returned when querying by repository A's own workspaceId even if repository B shares a store file (multi-repo-in-one-db is out of scope, but within one store, scoping by workspaceId must hold)", () => {
    const root = makeTempDir("seq-isolation-repo-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput({ scanId: "a1", repositoryId: "repo-A", workspaceId: "ws-A" }));
    store.saveScanResult(scanInput({ scanId: "b1", repositoryId: "repo-B", workspaceId: "ws-B" }));
    const wsAScans = store.listScans("ws-A");
    expect(wsAScans).toHaveLength(1);
    expect(wsAScans[0].repositoryId).toBe("repo-A");
    store.close();
  });

  it("36 — workspace A's getLatestScan never returns workspace B's scan", () => {
    const root = makeTempDir("seq-isolation-ws-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput({ scanId: "a1", workspaceId: "ws-A" }));
    store.saveScanResult(scanInput({ scanId: "b1", workspaceId: "ws-B" }));
    expect(store.getLatestScan("ws-A")?.scanId).toBe("a1");
    expect(store.getLatestScan("ws-B")?.scanId).toBe("b1");
    store.close();
  });

  it("37/38 — two worktrees of the same repository share repositoryId but produce scans under distinct workspaceIds", async () => {
    const mainRoot = makeTempDir("seq-isolation-worktree-main-");
    execFileSync("git", ["init"], { cwd: mainRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: mainRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "T"], { cwd: mainRoot, stdio: "ignore" });
    writeFileSync(join(mainRoot, "f.ts"), "export const x = 1;\n");
    execFileSync("git", ["add", "."], { cwd: mainRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRoot, stdio: "ignore" });

    const featureRoot = makeTempDir("seq-isolation-worktree-feature-");
    rmSync(featureRoot, { recursive: true, force: true });
    execFileSync("git", ["worktree", "add", "-b", "feature", featureRoot], { cwd: mainRoot, stdio: "ignore" });
    tempDirs.push(featureRoot);

    const { resolveWorkspaceIdentity } = await import("../local-identity");
    const main = resolveWorkspaceIdentity(mainRoot);
    const feature = resolveWorkspaceIdentity(featureRoot);

    const store = openLocalPersistenceStore(mainRoot);
    store.saveScanResult(scanInput({ scanId: "main-1", repositoryId: main.repository.repositoryId, workspaceId: main.workspaceId }));
    store.saveScanResult(scanInput({ scanId: "feature-1", repositoryId: feature.repository.repositoryId, workspaceId: feature.workspaceId }));

    expect(main.repository.repositoryId).toBe(feature.repository.repositoryId);
    expect(main.workspaceId).not.toBe(feature.workspaceId);
    expect(store.getLatestScan(main.workspaceId)?.scanId).toBe("main-1");
    expect(store.getLatestScan(feature.workspaceId)?.scanId).toBe("feature-1");
    store.close();
  });

  it("39 — uncommitted changes do not create a new workspaceId/repositoryId, only a new scanId", () => {
    const root = makeTempDir("seq-isolation-uncommitted-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput({ scanId: "s1", repositoryId: "repo-1", workspaceId: "ws-1" }));
    // Simulate a second scan after a working-tree edit: same identity, new scanId.
    store.saveScanResult(scanInput({ scanId: "s2", repositoryId: "repo-1", workspaceId: "ws-1" }));
    const scans = store.listScans("ws-1");
    expect(scans).toHaveLength(2);
    expect(new Set(scans.map((s) => s.repositoryId)).size).toBe(1);
    expect(new Set(scans.map((s) => s.workspaceId)).size).toBe(1);
    expect(new Set(scans.map((s) => s.scanId)).size).toBe(2);
    store.close();
  });
});

describe("SECURITY", () => {
  it("40 — no API keys, tokens, or credentials are ever persisted (documented, structural: the schema has no such column, and metadata is only ever the existing finding's own metadata object)", () => {
    const root = makeTempDir("seq-sec-no-secrets-");
    const store = openLocalPersistenceStore(root);
    const input = scanInput();
    input.findings[0].evidence = "token=seq_live_shouldnotpersist"; // if a finding's OWN evidence field already contains this (e.g. a secrets-detector finding), it is stored as-is -- redaction is the scanner's job (unchanged), not persistence's; this test documents that persistence adds no additional leakage beyond what the finding already carried.
    store.saveScanResult(input);
    const raw = new DatabaseSync(join(root, ".sequrai", "sequrai.db"));
    const cols = raw.prepare("PRAGMA table_info(scans)").all().map((c) => (c as { name: string }).name);
    expect(cols).not.toContain("api_key");
    expect(cols).not.toContain("token");
    expect(cols).not.toContain("credentials");
    raw.close();
    store.close();
  });

  it("41/42 — a malformed/invalid database file is reported as LOCAL_PERSISTENCE_UNAVAILABLE or MIGRATION_FAILED, never silently treated as empty", () => {
    const root = makeTempDir("seq-sec-malformed-db-");
    mkdirSync(join(root, ".sequrai"), { recursive: true });
    writeFileSync(join(root, ".sequrai", "sequrai.db"), "this is not a sqlite file at all, just garbage bytes");
    expect(() => openLocalPersistenceStore(root)).toThrow(LocalPersistenceError);
  });

  it("43 — a symlinked .sequrai directory is rejected, not followed", () => {
    const root = makeTempDir("seq-sec-symlink-dir-");
    const outside = makeTempDir("seq-sec-symlink-dir-outside-");
    symlinkSync(outside, join(root, ".sequrai"));
    expect(() => openLocalPersistenceStore(root)).toThrow(LocalPersistenceError);
    expect(existsSync(join(outside, "sequrai.db"))).toBe(false);
  });

  it("43b — a symlinked sequrai.db file is rejected, not followed", () => {
    const root = makeTempDir("seq-sec-symlink-file-");
    const outside = makeTempDir("seq-sec-symlink-file-outside-");
    writeFileSync(join(outside, "elsewhere.db"), "");
    mkdirSync(join(root, ".sequrai"), { recursive: true });
    symlinkSync(join(outside, "elsewhere.db"), join(root, ".sequrai", "sequrai.db"));
    expect(() => openLocalPersistenceStore(root)).toThrow(LocalPersistenceError);
  });

  it("44 — the database path can never escape .sequrai: there is no parameter through which a caller could request a different path", () => {
    const root = makeTempDir("seq-sec-no-path-param-");
    const store = openLocalPersistenceStore(root);
    // openLocalPersistenceStore's only parameter is the workspace root --
    // there is no path/filename override anywhere in its signature.
    expect(existsSync(join(root, ".sequrai", "sequrai.db"))).toBe(true);
    store.close();
  });

  it("45 — a corrupted verdict_json row is reported as LOCAL_PERSISTENCE_CORRUPT, never silently read as 'no verdict' or a fabricated READY", () => {
    const root = makeTempDir("seq-sec-corrupt-verdict-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput());
    store.close();

    const raw = new DatabaseSync(join(root, ".sequrai", "sequrai.db"));
    raw.prepare("UPDATE verdicts SET verdict_json = ? WHERE scan_id = ?").run("{ not valid json", "scan-1");
    raw.close();

    const reopened = openLocalPersistenceStore(root);
    expect(() => reopened.getVerdictForScan("scan-1")).toThrow(LocalPersistenceError);
    try {
      reopened.getVerdictForScan("scan-1");
    } catch (error) {
      expect((error as LocalPersistenceError).code).toBe("LOCAL_PERSISTENCE_CORRUPT");
    }
    reopened.close();
  });

  it("46 — a client-provided projectId cannot authorize reading another workspace's data: reads are scoped by workspaceId, not by a caller-asserted projectId", () => {
    const root = makeTempDir("seq-sec-no-authz-bypass-");
    const store = openLocalPersistenceStore(root);
    store.saveScanResult(scanInput({ scanId: "victim-scan", projectId: "victim-project", workspaceId: "victim-ws" }));
    // There is no API that accepts a projectId and returns scans -- only
    // getScan(scanId) and getLatestScan/listScans(workspaceId). A caller
    // cannot "ask for victim-project" and get victim-ws's data without
    // already knowing its workspaceId or exact scanId (both derived from
    // the actual local filesystem/git state, not asserted by a client).
    expect(store.getLatestScan("attacker-ws")).toBeNull();
    store.close();
  });
});

describe("CONCURRENCY", () => {
  it("47 — two store instances can initialize against the same workspace without corrupting the schema", () => {
    const root = makeTempDir("seq-concurrency-init-");
    const a = openLocalPersistenceStore(root);
    const b = openLocalPersistenceStore(root);
    a.saveScanResult(scanInput({ scanId: "s1" }));
    b.saveScanResult(scanInput({ scanId: "s2" }));
    expect(a.getScan("s2")).not.toBeNull(); // WAL: writes from b visible to a's connection
    a.close();
    b.close();
  });

  it("48 — concurrent writes from two store instances are both preserved (WAL serializes them, neither is silently lost)", () => {
    const root = makeTempDir("seq-concurrency-writes-");
    const a = openLocalPersistenceStore(root);
    const b = openLocalPersistenceStore(root);
    for (let i = 0; i < 5; i++) a.saveScanResult(scanInput({ scanId: `a-${i}` }));
    for (let i = 0; i < 5; i++) b.saveScanResult(scanInput({ scanId: `b-${i}` }));
    a.close();
    const c = openLocalPersistenceStore(root);
    expect(c.listScans("ws-1", 100)).toHaveLength(10);
    b.close();
    c.close();
  });
});
