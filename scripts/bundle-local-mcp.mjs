#!/usr/bin/env node
import esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public/mcp");
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "lib/local-analysis/runtime-entry.ts")],
  outfile: path.join(outDir, "local-verdict-bundle.mjs"),
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
