#!/usr/bin/env node
/**
 * Universal SequrAI MCP installer — run from any project folder.
 *
 * Cursor requires a local stdio bridge (HTTP URL alone does not work reliably).
 * This script installs the bridge once under ~/.sequrai/ and configures Cursor globally.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

async function downloadBridge(baseUrl, destination) {
  const response = await fetch(`${baseUrl}/mcp/stdio-bridge.mjs`);
  if (!response.ok) {
    throw new Error(`Could not download stdio bridge (${response.status}). Check ${baseUrl}/mcp/stdio-bridge.mjs`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, await response.text(), "utf8");
}

async function verifyKey(key, url) {
  const response = await fetch(`${url}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });

  if (response.status === 401) {
    throw new Error("Invalid API key. Generate a new one in SequrAI Settings → Connect my agent.");
  }
  if (!response.ok) {
    throw new Error(`SequrAI API check failed (${response.status}). Try again in a moment.`);
  }
}

function cursorStdioServer(key, url, bridgePath) {
  return {
    command: "node",
    args: [bridgePath],
    env: {
      SEQURAI_API_KEY: key,
      SEQURAI_API_URL: url,
    },
  };
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

async function main() {
  const { key, url } = parseArgs();
  const projectRoot = process.cwd();
  const home = homedir();
  const bridgePath = join(home, ".sequrai/stdio-bridge.mjs");

  console.log("Checking your SequrAI API key…");
  await verifyKey(key, url);

  console.log("Installing SequrAI bridge…");
  await downloadBridge(url, bridgePath);

  const cursorServer = cursorStdioServer(key, url, bridgePath);
  const globalCursorPath = installAt(home, ".cursor/mcp.json", (existing) => ({
    ...existing,
    mcpServers: mergeServer(existing.mcpServers, SERVER_NAME, cursorServer),
  }));
  const projectCursorPath = installAt(projectRoot, ".cursor/mcp.json", (existing) => ({
    ...existing,
    mcpServers: mergeServer(existing.mcpServers, SERVER_NAME, cursorServer),
  }));

  const claudeServer = {
    type: "stdio",
    command: "node",
    args: [bridgePath],
    env: {
      SEQURAI_API_KEY: key,
      SEQURAI_API_URL: url,
    },
  };

  const claudeProjectPath = installAt(projectRoot, ".mcp.json", (existing) => ({
    ...existing,
    mcpServers: mergeServer(existing.mcpServers, SERVER_NAME, claudeServer),
  }));

  const claudeGlobalPath = installAt(home, ".claude.json", (existing) => ({
    ...existing,
    mcpServers: mergeServer(existing.mcpServers, SERVER_NAME, claudeServer),
  }));

  const vscodePath = installAt(projectRoot, ".vscode/mcp.json", (existing) => ({
    ...existing,
    servers: mergeServer(existing.servers, SERVER_NAME, {
      type: "http",
      ...httpServer(key, url),
    }),
  }));

  console.log("");
  console.log("SequrAI connected.");
  console.log("");
  console.log("Next steps:");
  console.log("  Cursor:      quit fully → reopen → Settings → Tools & MCP → “sequrai” green");
  console.log("  Claude Code: restart → run /mcp → confirm “sequrai” is connected");
  console.log("  Then ask:    Can I deploy?");
  console.log("");
  console.log("Installed:");
  console.log(`  • Bridge:      ${bridgePath}`);
  console.log(`  • Cursor:      ${globalCursorPath}`);
  console.log(`  • Cursor proj: ${projectCursorPath}`);
  console.log(`  • Claude Code: ${claudeProjectPath}`);
  console.log(`  • Claude user: ${claudeGlobalPath}`);
  console.log(`  • VS Code:     ${vscodePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Install failed");
  process.exit(1);
});
