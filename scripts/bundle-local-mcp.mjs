#!/usr/bin/env node
import esbuild from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public/mcp");
const bundlePath = path.join(outDir, "local-verdict-bundle.mjs");
const manifestPath = path.join(outDir, "install-manifest.json");
mkdirSync(outDir, { recursive: true });

// Auto-Security MVP audit: server/security-engines/* (external
// OpenGrep/Trivy/crypto/Scorecard engines, called by
// lib/local-analysis/local-orchestrator.ts's runSecurityEngines()) all
// carry `import "server-only"` at the top -- correct for the Next.js app,
// where that package guards against a real Client Component accidentally
// bundling server code, but fatal here: this bundle is a plain Node script
// with no Next.js client/server graph at all, and the real "server-only"
// package throws unconditionally the instant it's imported. This was never
// caught before because no test had ever actually executed the real
// bundled artifact as a subprocess -- every prior local-analysis test
// imported the TypeScript source directly. Aliased to a no-op stub for
// THIS build only; every source file's own "server-only" import is
// untouched, so the real Next.js build's guard is unaffected.
const serverOnlyStub = path.join(root, "scripts/no-op-server-only-stub.mjs");

await esbuild.build({
  entryPoints: [path.join(root, "lib/local-analysis/runtime-entry.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  alias: {
    "@": root,
    "server-only": serverOnlyStub,
    "client-only": serverOnlyStub,
  },
  // Auto-Security MVP audit: server/security-engines/opengrep/engine.ts
  // references the CommonJS global `__dirname` (its OPENGREP_RULES_PATH
  // fallback) -- valid in the Next.js app's own module system, but esbuild
  // targets ESM output here, where `__dirname` doesn't exist at all and a
  // reference to it throws a ReferenceError the instant the module loads
  // (this crashed the ENTIRE bundle, not just that one fallback path).
  // Shimmed once for the whole output file via import.meta.url -- the
  // actual rules file isn't bundled alongside this script regardless (the
  // fallback path was always effectively unreachable locally without
  // OPENGREP_RULES_PATH set), so this only needs to stop the crash, not
  // resolve to a real rules directory.
  banner: {
    js: 'import { fileURLToPath as __sequraiFileURLToPath } from "node:url"; import { dirname as __sequraiDirname } from "node:path"; const __filename = __sequraiFileURLToPath(import.meta.url); const __dirname = __sequraiDirname(__filename);',
  },
  logLevel: "info",
});

console.log("Bundled local MCP runtime → public/mcp/local-verdict-bundle.mjs");

// The install-manifest.json checksum public/mcp/install.mjs verifies against
// must always describe the bundle this same build step just produced --
// otherwise every real installer run fails its integrity check the moment
// esbuild's output bytes drift from whatever hash was last hand-committed.
const bundleSha256 = createHash("sha256").update(readFileSync(bundlePath)).digest("hex");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.localAnalysis?.bundleSha256 !== bundleSha256) {
  manifest.localAnalysis.bundleSha256 = bundleSha256;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Updated install-manifest.json bundleSha256 → ${bundleSha256}`);
}
