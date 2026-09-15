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

await esbuild.build({
  entryPoints: [path.join(root, "lib/local-analysis/runtime-entry.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  alias: {
    "@": root,
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
