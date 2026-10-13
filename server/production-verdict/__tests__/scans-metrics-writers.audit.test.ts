import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Audit of every writer of the shared `scans.metrics` column (2026-10-13). The claim this protects:
//   "nothing can overwrite the evidence stored by the evidence writers, whatever the order of the calls".
// It rests on three facts, each pinned here:
//   1. only three code paths can write `metrics` on an existing scan row;
//   2. the two that REPLACE it match only in-progress statuses;
//   3. the database trigger `trg_scans_prevent_immutable_core` locks a scan when it reaches a terminal status (nothing but `metrics` and
//      `updated_at` may change afterwards: a completed scan can never go back to an in-progress status), and the evidence writers
//      (`requireStatus: ["completed"]`) only write on a completed scan.
// A new writer of `scans` fails this test until it is reviewed and added.

const ROOTS = ["server", "lib", "app", "inngest", "brain", "features", "scripts"];
function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\./.test(name)) yield path;
  }
}

type Writer = { file: string; payload: string; touchesMetrics: boolean };
function scanWriters(): Writer[] {
  const found: Writer[] = [];
  for (const root of ROOTS) {
    let exists = true;
    try { statSync(root); } catch { exists = false; }
    if (!exists) continue;
    for (const file of sources(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\.from\(\s*["']scans["']\s*\)/g)) {
        const end = text.indexOf(";", match.index! + match[0].length);
        const statement = text.slice(match.index!, end > 0 ? end : match.index! + 600);
        const call = /\.(update|upsert)\(([\s\S]{0,60})/.exec(statement);
        if (call) found.push({ file, payload: call[2].replace(/\s+/g, " ").trim(), touchesMetrics: statement.includes("metrics") });
      }
    }
  }
  return found;
}

describe("writers of the scans table", () => {
  const writers = scanWriters();

  it("only three code paths can write `metrics` on an existing scan: the conditional writer, the supersede writer and the runner's gated update", () => {
    const metricsWriters = writers.filter((w) => w.touchesMetrics).map((w) => w.file).sort();
    expect(metricsWriters).toEqual([
      "server/production-verdict/scan-metrics.ts",
      "server/review-start/release-active-review-for-new-head.ts",
    ]);
    // The runner passes its payload as a variable (`update(values)`); it is the third path and is checked below.
    const opaque = writers.filter((w) => !w.touchesMetrics && /^values\b/.test(w.payload)).map((w) => w.file);
    expect(opaque).toEqual(["server/security-scanner/scan-job-runner.ts"]);
  });

  it("every other writer sets literal, non-metrics columns", () => {
    const others = writers.filter((w) => !w.touchesMetrics && !/^values\b/.test(w.payload));
    expect(others.length).toBeGreaterThan(5);
    for (const w of others) expect(w.payload.startsWith("{")).toBe(true);
  });

  it("the runner's update and the supersede writer match only in-progress statuses", () => {
    const runner = readFileSync("server/security-scanner/scan-job-runner.ts", "utf8");
    const statuses = /const ACTIVE_SCAN_UPDATE_STATUSES = \[([\s\S]*?)\] as const;/.exec(runner)![1].match(/"([a-z_]+)"/g)!.map((s) => s.slice(1, -1));
    expect(statuses.sort()).toEqual(["calculating_score", "fetching_repository", "indexing", "queued", "scanning"]);
    expect(runner).toMatch(/\.update\(values\)[\s\S]{0,80}\.eq\("id", scanId\)[\s\S]{0,40}\.in\("status", \[\.\.\.ACTIVE_SCAN_UPDATE_STATUSES\]\)/);
    const supersede = readFileSync("server/review-start/release-active-review-for-new-head.ts", "utf8");
    const active = /const ACTIVE_SCAN_STATUSES = \[([\s\S]*?)\] as const;/.exec(supersede)![1].match(/"([a-z_]+)"/g)!.map((s) => s.slice(1, -1));
    expect(active.sort()).toEqual(statuses);
    expect(supersede).toMatch(/\.in\("status", \[\.\.\.ACTIVE_SCAN_STATUSES\]\)/);
    for (const terminal of ["completed", "failed", "cancelled"]) {
      expect(statuses).not.toContain(terminal);
    }
  });

  it("the evidence writers require a completed scan", () => {
    const finalization = readFileSync("server/production-verdict/evidence-finalization.ts", "utf8");
    expect((finalization.match(/requireStatus: \["completed"\]/g) ?? []).length).toBe(2); // marker + record
  });

  it("the database lock exists in the migrations (a terminal scan cannot change anything but metrics/updated_at)", () => {
    const migrations = readdirSync("database/migrations").map((f) => readFileSync(join("database/migrations", f), "utf8")).join("\n");
    expect(migrations).toMatch(/prevent_immutable_scan_core_mutation/);
    expect(migrations).toMatch(/to_jsonb\(new\) - 'metrics' - 'updated_at'/);
    expect(migrations).toMatch(/set_scan_immutability_lock/);
  });
});
