#!/usr/bin/env node
// Phase 35.5: bundles worker/entry.ts into a standalone Node-runnable file,
// same pattern as scripts/bundle-local-mcp.mjs. This is what
// worker/Dockerfile actually runs -- it does not run Next.js at all.
import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "worker/dist");
mkdirSync(outDir, { recursive: true });

// The commit the bundle is built from: explicit env, else worker/BUILD_INFO.json (written by scripts/export-worker-source.sh, because the
// deploy upload has no .git), else git, else "unknown".
function buildCommit() {
  if (process.env.WORKER_BUILD_COMMIT?.trim()) return process.env.WORKER_BUILD_COMMIT.trim();
  try { return JSON.parse(readFileSync(path.join(root, "worker/BUILD_INFO.json"), "utf8")).commit; } catch { /* not present */ }
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { /* no git */ }
  return "unknown";
}

await esbuild.build({
  define: { __WORKER_BUILD_COMMIT__: JSON.stringify(buildCommit()) },
  entryPoints: [path.join(root, "worker/entry.ts")],
  outfile: path.join(outDir, "worker-bundle.cjs"),
  bundle: true,
  platform: "node",
  // CJS, not ESM: a transitive dependency (tar-stream, pulled in by the
  // GitHub tarball-fetch path) uses a dynamic `require()` that esbuild's
  // ESM output can't polyfill (confirmed by a real crash: "Dynamic require
  // of 'events' is not supported"). Native CJS `require` handles it
  // directly with no shim needed.
  format: "cjs",
  target: "node22",
  // "server-only" is a Next.js-specific guard that throws outside the
  // Next.js runtime -- irrelevant (and actively wrong) for this standalone
  // worker process, so every module importing it is marked external-safe
  // by aliasing it to a no-op.
  alias: {
    "@": root,
    "server-only": path.join(root, "worker/server-only-noop.mjs"),
  },
  logLevel: "info",
});

console.log("Bundled Security Execution Worker → worker/dist/worker-bundle.cjs");
