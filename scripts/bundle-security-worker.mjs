#!/usr/bin/env node
// Phase 35.5: bundles worker/entry.ts into a standalone Node-runnable file,
// same pattern as scripts/bundle-local-mcp.mjs. This is what
// worker/Dockerfile actually runs -- it does not run Next.js at all.
import esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "worker/dist");
mkdirSync(outDir, { recursive: true });

await esbuild.build({
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
