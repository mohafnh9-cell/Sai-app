import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isDescendantPath, normalizeWorkspaceRoot, realpathResolved } from "./workspace";
import type { VerdictFinding } from "./local-orchestrator";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

/**
 * L1.3 -- gives the Local Security Runtime a memory across process/session
 * restarts. This module is the ONLY place that touches SQLite; nothing
 * else (the orchestrator, run-local-verdict.ts, MCP handlers) should open
 * a database connection directly.
 *
 * Uses Node's built-in `node:sqlite` (DatabaseSync), not an npm dependency
 * like better-sqlite3. This is a deliberate choice specific to how this
 * runtime is actually distributed: public/mcp/local-verdict-bundle.mjs is
 * downloaded directly by install.mjs into ~/.sequrai/ -- there is no `npm
 * install` step on the end user's machine at all. A native npm addon
 * (better-sqlite3's .node binary) cannot be bundled by esbuild into that
 * single-file distribution, and would need to already exist in a
 * node_modules tree that will never exist there. node:sqlite ships inside
 * Node itself (available, unflagged, since Node 22.5 -- this project
 * already requires Node >=22), so it works identically in this bundle, in
 * a plain `node script.ts` run, and inside the Next.js/server context,
 * with zero new dependencies and no native-binary distribution problem.
 * Honest tradeoff: it is still an experimental Node API (a runtime
 * warning, not an error, is emitted) -- documented here rather than
 * hidden.
 *
 * WHAT THIS STORES: scans, findings, and verdicts this machine's own
 * local analysis has already produced -- the runtime's memory of what it
 * observed. WHAT IT DOES NOT STORE: any credential, token, or API key; any
 * full source file (only file paths + line numbers, the same information
 * already in the existing finding representation); anything from outside
 * the existing redacted finding/verdict objects.
 *
 * WHAT A ROW MEANS: a persisted verdict is a HISTORICAL result, tied to
 * the commit/dirty-state it was computed against -- it is never
 * re-interpreted as the current state of the working tree, and a row's
 * mere existence never implies "verified" or authorizes anything. A
 * persisted projectId is identity metadata (see local-identity.ts's own
 * doc comment) -- this store is not authoritative for cloud ownership,
 * billing, or MCP authorization, and never will be.
 */

const DB_DIRNAME = ".sequrai";
const DB_FILENAME = "sequrai.db";
const SCHEMA_VERSION = 1;

export class LocalPersistenceError extends Error {
  constructor(
    public readonly code:
      | "LOCAL_PERSISTENCE_UNAVAILABLE"
      | "LOCAL_PERSISTENCE_CORRUPT"
      | "LOCAL_PERSISTENCE_MIGRATION_FAILED"
      | "LOCAL_PERSISTENCE_WRITE_FAILED"
      | "LOCAL_PERSISTENCE_READ_FAILED",
    message: string
  ) {
    super(message);
    this.name = "LocalPersistenceError";
  }
}

export type PersistedScan = {
  scanId: string;
  projectId: string;
  repositoryId: string;
  workspaceId: string;
  scope: string;
  phase: string;
  branch: string | null;
  commitSha: string | null;
  dirty: boolean;
  durationMs: number;
  errorMessage: string | null;
  engines: Array<{ engine: string; status: string; durationMs: number; findingsCount: number }>;
  createdAt: string;
  completedAt: string;
};

export type PersistedFinding = VerdictFinding & { scanId: string };

export type PersistedVerdict = {
  scanId: string;
  projectId: string;
  repositoryId: string;
  workspaceId: string;
  status: string;
  score: number | null;
  blockersCount: number;
  criticalBlockersCount: number;
  highBlockersCount: number;
  verdict: ProductionVerdictV1;
  createdAt: string;
};

export type SaveScanResultInput = {
  scan: Omit<PersistedScan, "createdAt" | "completedAt"> & { createdAt?: string; completedAt?: string };
  findings: VerdictFinding[];
  verdict?: {
    projectId: string;
    repositoryId: string;
    workspaceId: string;
    status: string;
    score: number | null;
    blockersCount: number;
    criticalBlockersCount: number;
    highBlockersCount: number;
    verdict: ProductionVerdictV1;
  };
};

export type LocalPersistenceStore = {
  saveScanResult(input: SaveScanResultInput): void;
  getScan(scanId: string): PersistedScan | null;
  getLatestScan(workspaceId: string): PersistedScan | null;
  listScans(workspaceId: string, limit?: number): PersistedScan[];
  getFindingsForScan(scanId: string): PersistedFinding[];
  getVerdictForScan(scanId: string): PersistedVerdict | null;
  close(): void;
};

/**
 * Resolves .sequrai/sequrai.db under `workspaceRoot`, refusing to follow a
 * symlinked .sequrai directory or a symlinked db file outside the
 * workspace -- reuses the same realpath/descendant-path primitives
 * workspace.ts's own resolveAuthorizedWorkspacePath is built from, rather
 * than a second traversal/symlink check. There is no caller-supplied path
 * input anywhere in this function; the relative path is fixed.
 */
function resolveSecureDatabasePath(workspaceRoot: string): string {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const rootReal = realpathResolved(root);
  const dbDir = join(rootReal, DB_DIRNAME);

  if (existsSync(dbDir)) {
    const dirStat = lstatSync(dbDir);
    if (dirStat.isSymbolicLink()) {
      throw new LocalPersistenceError("LOCAL_PERSISTENCE_UNAVAILABLE", "Refusing to use a symlinked .sequrai directory.");
    }
    const dirReal = realpathResolved(dbDir);
    if (!isDescendantPath(rootReal, dirReal)) {
      throw new LocalPersistenceError("LOCAL_PERSISTENCE_UNAVAILABLE", "Refusing a .sequrai directory outside the workspace.");
    }
  } else {
    mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = join(dbDir, DB_FILENAME);
  if (existsSync(dbPath) && lstatSync(dbPath).isSymbolicLink()) {
    throw new LocalPersistenceError("LOCAL_PERSISTENCE_UNAVAILABLE", "Refusing a symlinked database file.");
  }

  return dbPath;
}

function runMigrations(db: DatabaseSync): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as
      | { version: number | null }
      | undefined;
    const currentVersion = row?.version ?? 0;

    if (currentVersion < 1) {
      db.exec("BEGIN");
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS scans (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            repository_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            scope TEXT NOT NULL,
            phase TEXT NOT NULL,
            branch TEXT,
            commit_sha TEXT,
            dirty INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            error_message TEXT,
            engines_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            completed_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_scans_workspace_created
            ON scans (workspace_id, created_at);

          CREATE TABLE IF NOT EXISTS findings (
            row_id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id TEXT NOT NULL REFERENCES scans (id),
            repository_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            rule_id TEXT,
            title TEXT NOT NULL,
            severity TEXT,
            category TEXT,
            file_path TEXT,
            start_line INTEGER,
            recommendation TEXT,
            confidence TEXT,
            evidence TEXT,
            metadata_json TEXT,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_findings_scan ON findings (scan_id);

          CREATE TABLE IF NOT EXISTS verdicts (
            scan_id TEXT PRIMARY KEY REFERENCES scans (id),
            project_id TEXT NOT NULL,
            repository_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            status TEXT NOT NULL,
            score INTEGER,
            blockers_count INTEGER NOT NULL,
            critical_blockers_count INTEGER NOT NULL,
            high_blockers_count INTEGER NOT NULL,
            verdict_json TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
        `);
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
          1,
          new Date().toISOString()
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  } catch (error) {
    throw new LocalPersistenceError(
      "LOCAL_PERSISTENCE_MIGRATION_FAILED",
      error instanceof Error ? error.message : "Local database migration failed."
    );
  }
}

function findingRow(scanId: string, finding: VerdictFinding, createdAt: string) {
  return [
    scanId,
    finding.rule_id ?? null,
    finding.title,
    finding.severity ?? null,
    finding.category ?? null,
    finding.file_path ?? null,
    finding.start_line ?? null,
    finding.recommendation ?? null,
    typeof finding.confidence === "string" ? finding.confidence : finding.confidence != null ? String(finding.confidence) : null,
    finding.evidence ?? null,
    finding.metadata ? JSON.stringify(finding.metadata) : null,
    createdAt,
  ];
}

function rowToScan(row: Record<string, unknown>): PersistedScan {
  return {
    scanId: row.id as string,
    projectId: row.project_id as string,
    repositoryId: row.repository_id as string,
    workspaceId: row.workspace_id as string,
    scope: row.scope as string,
    phase: row.phase as string,
    branch: (row.branch as string | null) ?? null,
    commitSha: (row.commit_sha as string | null) ?? null,
    dirty: Boolean(row.dirty),
    durationMs: Number(row.duration_ms),
    errorMessage: (row.error_message as string | null) ?? null,
    engines: JSON.parse(row.engines_json as string),
    createdAt: row.created_at as string,
    completedAt: row.completed_at as string,
  };
}

function rowToFinding(row: Record<string, unknown>): PersistedFinding {
  return {
    id: `${row.scan_id}:${row.row_id}`,
    scanId: row.scan_id as string,
    title: row.title as string,
    severity: (row.severity as string | null) ?? undefined,
    category: (row.category as string | null) ?? undefined,
    rule_id: (row.rule_id as string | null) ?? undefined,
    file_path: (row.file_path as string | null) ?? undefined,
    start_line: (row.start_line as number | null) ?? undefined,
    recommendation: (row.recommendation as string | null) ?? undefined,
    confidence: (row.confidence as string | null) ?? undefined,
    evidence: (row.evidence as string | null) ?? undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json as string) : undefined,
  };
}

function rowToVerdict(row: Record<string, unknown>): PersistedVerdict {
  let verdict: ProductionVerdictV1;
  try {
    verdict = JSON.parse(row.verdict_json as string);
  } catch {
    // A row that exists but whose payload can't be parsed is corruption,
    // never silently treated as "no verdict" -- see the module doc
    // comment's "current vs historical" and "never manufacture READY" rules.
    throw new LocalPersistenceError("LOCAL_PERSISTENCE_CORRUPT", `Stored verdict for scan ${row.scan_id} is not valid JSON.`);
  }
  return {
    scanId: row.scan_id as string,
    projectId: row.project_id as string,
    repositoryId: row.repository_id as string,
    workspaceId: row.workspace_id as string,
    status: row.status as string,
    score: (row.score as number | null) ?? null,
    blockersCount: Number(row.blockers_count),
    criticalBlockersCount: Number(row.critical_blockers_count),
    highBlockersCount: Number(row.high_blockers_count),
    verdict,
    createdAt: row.created_at as string,
  };
}

/**
 * Opens (creating if necessary) the local SQLite store for a workspace.
 * One store instance per operation/caller is expected -- callers should
 * `close()` when done rather than holding a long-lived global singleton.
 */
export function openLocalPersistenceStore(workspaceRoot: string): LocalPersistenceStore {
  const dbPath = resolveSecureDatabasePath(workspaceRoot);

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath);
  } catch (error) {
    throw new LocalPersistenceError(
      "LOCAL_PERSISTENCE_UNAVAILABLE",
      error instanceof Error ? error.message : "Could not open the local database."
    );
  }

  try {
    // WAL: crash-safe, allows a reader to run concurrently with a writer
    // (two local reviews / a review while a client lists history) without
    // blocking each other -- the right default for a single-machine,
    // possibly-multi-process local tool. synchronous=NORMAL is WAL's
    // documented safe pairing: still durable against application crashes,
    // just not against a simultaneous OS-level power loss mid-write --
    // an acceptable tradeoff for security metadata on a developer laptop,
    // not for a system of record. foreign_keys=ON enforces
    // findings/verdicts -> scans referential integrity at the database
    // level rather than only in application code.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA foreign_keys = ON");
  } catch (error) {
    db.close();
    throw new LocalPersistenceError(
      "LOCAL_PERSISTENCE_UNAVAILABLE",
      error instanceof Error ? error.message : "Could not configure the local database."
    );
  }

  runMigrations(db);

  return {
    saveScanResult(input: SaveScanResultInput): void {
      const now = new Date().toISOString();
      const createdAt = input.scan.createdAt ?? now;
      const completedAt = input.scan.completedAt ?? now;

      try {
        db.exec("BEGIN");
        db.prepare(
          `INSERT INTO scans
            (id, project_id, repository_id, workspace_id, scope, phase, branch, commit_sha, dirty, duration_ms, error_message, engines_json, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          input.scan.scanId,
          input.scan.projectId,
          input.scan.repositoryId,
          input.scan.workspaceId,
          input.scan.scope,
          input.scan.phase,
          input.scan.branch,
          input.scan.commitSha,
          input.scan.dirty ? 1 : 0,
          input.scan.durationMs,
          input.scan.errorMessage,
          JSON.stringify(input.scan.engines),
          createdAt,
          completedAt
        );

        const insertFinding = db.prepare(
          `INSERT INTO findings
            (scan_id, repository_id, workspace_id, rule_id, title, severity, category, file_path, start_line, recommendation, confidence, evidence, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const finding of input.findings) {
          const [, ruleId, title, severity, category, filePath, startLine, recommendation, confidence, evidence, metadataJson, createdAtCol] =
            findingRow(input.scan.scanId, finding, createdAt);
          insertFinding.run(
            input.scan.scanId,
            input.scan.repositoryId,
            input.scan.workspaceId,
            ruleId as string | null,
            title as string,
            severity as string | null,
            category as string | null,
            filePath as string | null,
            startLine as number | null,
            recommendation as string | null,
            confidence as string | null,
            evidence as string | null,
            metadataJson as string | null,
            createdAtCol as string
          );
        }

        if (input.verdict) {
          db.prepare(
            `INSERT INTO verdicts
              (scan_id, project_id, repository_id, workspace_id, status, score, blockers_count, critical_blockers_count, high_blockers_count, verdict_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            input.scan.scanId,
            input.verdict.projectId,
            input.verdict.repositoryId,
            input.verdict.workspaceId,
            input.verdict.status,
            input.verdict.score,
            input.verdict.blockersCount,
            input.verdict.criticalBlockersCount,
            input.verdict.highBlockersCount,
            JSON.stringify(input.verdict.verdict),
            createdAt
          );
        }

        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Nothing to roll back if BEGIN itself never succeeded.
        }
        throw new LocalPersistenceError(
          "LOCAL_PERSISTENCE_WRITE_FAILED",
          error instanceof Error ? error.message : "Failed to persist the scan result."
        );
      }
    },

    getScan(scanId: string): PersistedScan | null {
      try {
        const row = db.prepare("SELECT * FROM scans WHERE id = ?").get(scanId) as
          | Record<string, unknown>
          | undefined;
        return row ? rowToScan(row) : null;
      } catch (error) {
        throw new LocalPersistenceError(
          "LOCAL_PERSISTENCE_READ_FAILED",
          error instanceof Error ? error.message : "Failed to read scan."
        );
      }
    },

    getLatestScan(workspaceId: string): PersistedScan | null {
      try {
        const row = db
          .prepare("SELECT * FROM scans WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
          .get(workspaceId) as Record<string, unknown> | undefined;
        return row ? rowToScan(row) : null;
      } catch (error) {
        throw new LocalPersistenceError(
          "LOCAL_PERSISTENCE_READ_FAILED",
          error instanceof Error ? error.message : "Failed to read the latest scan."
        );
      }
    },

    listScans(workspaceId: string, limit = 20): PersistedScan[] {
      try {
        const rows = db
          .prepare("SELECT * FROM scans WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
          .all(workspaceId, limit) as Record<string, unknown>[];
        return rows.map(rowToScan);
      } catch (error) {
        throw new LocalPersistenceError(
          "LOCAL_PERSISTENCE_READ_FAILED",
          error instanceof Error ? error.message : "Failed to list scans."
        );
      }
    },

    getFindingsForScan(scanId: string): PersistedFinding[] {
      try {
        const rows = db
          .prepare("SELECT * FROM findings WHERE scan_id = ? ORDER BY row_id ASC")
          .all(scanId) as Record<string, unknown>[];
        return rows.map(rowToFinding);
      } catch (error) {
        throw new LocalPersistenceError(
          "LOCAL_PERSISTENCE_READ_FAILED",
          error instanceof Error ? error.message : "Failed to read findings."
        );
      }
    },

    getVerdictForScan(scanId: string): PersistedVerdict | null {
      let row: Record<string, unknown> | undefined;
      try {
        row = db.prepare("SELECT * FROM verdicts WHERE scan_id = ?").get(scanId) as
          | Record<string, unknown>
          | undefined;
      } catch (error) {
        throw new LocalPersistenceError(
          "LOCAL_PERSISTENCE_READ_FAILED",
          error instanceof Error ? error.message : "Failed to read verdict."
        );
      }
      return row ? rowToVerdict(row) : null;
    },

    close(): void {
      db.close();
    },
  };
}
