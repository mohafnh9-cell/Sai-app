#!/usr/bin/env node
/**
 * Universal SequrAI MCP installer — run from any project folder.
 *
 * Usage:
 *   curl -fsSL https://sequrai-app.vercel.app/mcp/install.mjs -o install.mjs
 *   node install.mjs --key seq_live_...
 *
 * Writes project-level MCP config for Cursor, Claude Code, and VS Code.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SERVER_NAME = "sequrai";
const DEFAULT_URL = "https://sequrai-app.vercel.app";

function parseArgs() {
  let key = process.env.SEQURAI_API_KEY?.trim();
  let url = process.env.SEQURAI_API_URL?.trim() || DEFAULT_URL;

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--key" && args[index + 1]) {
      key = args[++index]?.trim();
      continue;
    }
    if (arg === "--url" && args[index + 1]) {
      url = args[++index]?.trim();
      continue;
    }
  }

  if (!key) {
    console.error("Missing --key seq_live_... (or set SEQURAI_API_KEY).");
    process.exit(1);
  }

  return { key, url: url.replace(/\/$/, "") };
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mergeServer(existing, serverName, serverConfig) {
  const next = existing && typeof existing === "object" ? { ...existing } : {};
  next[serverName] = serverConfig;
  return next;
}

function httpServer(key, url) {
  return {
    url: `${url}/api/mcp`,
    headers: {
      Authorization: `Bearer ${key}`,
    },
  };
}

function installAt(root, relativePath, mutator) {
  const path = join(root, relativePath);
  const existing = readJson(path) ?? {};
  const next = mutator(existing);
  writeJson(path, next);
  return path;
}

function main() {
  const { key, url } = parseArgs();
  const root = process.cwd();
  const transport = httpServer(key, url);

  const cursorPath = installAt(root, ".cursor/mcp.json", (existing) => ({
    ...existing,
    mcpServers: mergeServer(existing.mcpServers, SERVER_NAME, transport),
  }));

  const claudePath = installAt(root, ".mcp.json", (existing) => ({
    ...existing,
    mcpServers: mergeServer(existing.mcpServers, SERVER_NAME, {
      type: "http",
      ...transport,
    }),
  }));

  const vscodePath = installAt(root, ".vscode/mcp.json", (existing) => ({
    ...existing,
    servers: mergeServer(existing.servers, SERVER_NAME, {
      type: "http",
      ...transport,
    }),
  }));

  console.log("SequrAI MCP connected for this project.");
  console.log("");
  console.log(`Endpoint: ${transport.url}`);
  console.log("");
  console.log("Updated:");
  console.log(`  • Cursor:      ${cursorPath}`);
  console.log(`  • Claude Code: ${claudePath}`);
  console.log(`  • VS Code:     ${vscodePath}`);
  console.log("");
  console.log("Restart your code agent, then ask: Can I deploy?");
}

main();
