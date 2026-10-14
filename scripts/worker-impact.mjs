#!/usr/bin/env node
/**
 * Does a change need a WORKER redeploy (Railway), not just the Vercel deploy that merging to main already does?
 * Usage: node scripts/worker-impact.mjs <deployedWorkerCommit> [<toRef>=HEAD]
 * It bundles the worker from the CURRENT checkout with a metafile (every source file that goes into the bundle) and intersects it with
 * `git diff --name-only <deployed> <to>`. Exit 0 = no worker-relevant change; exit 1 = the worker is out of date (lists the files).
 * The deployed commit is readable from the database: security_jobs.claimed_by = worker-<commit7>-<pid>-<start> (see docs/WORKER_DELIVERY.md).
 */
import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [from, to = "HEAD"] = process.argv.slice(2);
if (!from) { console.error("usage: node scripts/worker-impact.mjs <deployedWorkerCommit> [<toRef>]"); process.exit(2); }

const result = await esbuild.build({
  entryPoints: [path.join(root, "worker/entry.ts")], bundle: true, write: false, metafile: true, platform: "node", format: "cjs", target: "node22", logLevel: "silent",
  alias: { "@": root, "server-only": path.join(root, "worker/server-only-noop.mjs") },
});
const inBundle = new Set(Object.keys(result.metafile.inputs).filter((f) => !f.startsWith("node_modules/")));
const extra = new Set(["package-lock.json", "worker/Dockerfile", "railway.json", "scripts/bundle-security-worker.mjs"]); // also change what the image runs
const changed = execFileSync("git", ["diff", "--name-only", from, to], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const relevant = changed.filter((f) => inBundle.has(f) || extra.has(f) || f.startsWith("server/security-engines/opengrep/rules/"));
if (relevant.length === 0) { console.log(`worker up to date with respect to ${from.slice(0, 7)}..${to}: no bundled file changed (${changed.length} files changed overall)`); process.exit(0); }
console.log(`WORKER UPDATE REQUIRED: ${relevant.length} bundled file(s) changed since ${from.slice(0, 7)}:`);
for (const f of relevant) console.log(`  ${f}`);
process.exit(1);
