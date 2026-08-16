#!/usr/bin/env node
/**
 * Universal SequrAI MCP installer — run from your project folder.
 *
 * Security defaults:
 * - API key via SEQURAI_API_KEY env var or interactive prompt (never required as CLI arg)
 * - Secrets stored in .sequrai/mcp.env (gitignored, mode 600)
 * - Project scope by default (no global MCP config unless --scope global)
 * - Bridge integrity verified via install-manifest.json SHA-256
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";

const SERVER_NAME = "sequrai";
const DEFAULT_URL = "https://sequrai-app.vercel.app";
const INSTALLER_VERSION = "2.0.0";

function parseArgs() {
  let url = process.env.SEQURAI_API_URL?.trim() || DEFAULT_URL;
  let scope = "project";

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--url" && args[index + 1]) {
      url = args[++index]?.trim();
      continue;
    }
    if (arg === "--scope" && args[index + 1]) {
      scope = args[++index]?.trim();
      continue;
    }
    if (arg === "--key") {
      console.error(
        "Refusing --key: API keys must not appear in shell history or process arguments.\n" +
          "Use: export SEQURAI_API_KEY=seq_live_...  OR run this installer interactively."
      );
      process.exit(1);
    }
  }

  if (scope !== "project" && scope !== "global") {
    console.error('Invalid --scope. Use "project" (default) or "global".');
    process.exit(1);
  }

  return { url: url.replace(/\/$/, ""), scope };
}

async function resolveApiKey() {
  const fromEnv = process.env.SEQURAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  if (!process.stdin.isTTY) {
    console.error(
      "Missing SEQURAI_API_KEY.\n" +
        "Generate a key in SequrAI Settings → Connect my agent, then run:\n" +
        "  export SEQURAI_API_KEY=seq_live_...\n" +
        "  node .sequrai-mcp-install.mjs"
    );
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Paste your SequrAI API key (seq_live_...): ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
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

async function fetchManifest(baseUrl) {
  const response = await fetch(`${baseUrl}/mcp/install-manifest.json`);
  if (!response.ok) {
    throw new Error(`Could not download install manifest (${response.status}).`);
  }
  return response.json();
}

async function downloadVerifiedFile(baseUrl, relativePath, destination, expectedSha256) {
  const response = await fetch(`${baseUrl}${relativePath}`);
  if (!response.ok) {
    throw new Error(`Could not download ${relativePath} (${response.status}).`);
  }
  const content = await response.text();
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (expectedSha256 && sha256 !== expectedSha256) {
    throw new Error(`Integrity check failed for ${relativePath} (SHA-256 mismatch).`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content, "utf8");
  return sha256;
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

function writeSecureEnvFile(projectRoot, key, url) {
  const envDir = join(projectRoot, ".sequrai");
  const envPath = join(envDir, "mcp.env");
  mkdirSync(envDir, { recursive: true });
  writeFileSync(envPath, `SEQURAI_API_KEY=${key}\nSEQURAI_API_URL=${url}\n`, { mode: 0o600 });
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // best effort on platforms without chmod
  }
  return envPath;
}

function ensureGitignoreEntries(projectRoot) {
  const gitignorePath = join(projectRoot, ".gitignore");
  const required = [".sequrai/mcp.env", ".sequrai-mcp-install.mjs"];
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  const missing = required.filter((entry) => !lines.some((line) => line.trim() === entry));
  if (missing.length === 0) return gitignorePath;
  const suffix = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  writeFileSync(
    gitignorePath,
    `${existing}${suffix}${missing.map((entry) => `${entry}\n`).join("")}`,
    "utf8"
  );
  return gitignorePath;
}

function cursorStdioServer(url, bridgePath, workspaceRoot) {
  return {
    command: "node",
    args: [bridgePath],
    env: {
      SEQURAI_API_URL: url,
      SEQURAI_WORKSPACE_ROOT: workspaceRoot,
    },
  };
}

function httpServerEnvRef(url) {
  return {
    type: "http",
    url: `${url}/api/mcp`,
    headers: {
      Authorization: "Bearer ${SEQURAI_API_KEY}",
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
  const { url, scope } = parseArgs();
  const key = await resolveApiKey();
  if (!key.startsWith("seq_live_")) {
    throw new Error("Invalid API key format. Expected seq_live_...");
  }

  const projectRoot = process.cwd();
  const home = homedir();

  console.log(`SequrAI MCP installer v${INSTALLER_VERSION}`);
  console.log("Checking your SequrAI API key…");
  await verifyKey(key, url);

  console.log("Verifying MCP runtime integrity…");
  const manifest = await fetchManifest(url);
  const sequraiDir = join(home, ".sequrai");
  const bridgePath = join(sequraiDir, "stdio-bridge.mjs");
  const localAnalysisPath = join(sequraiDir, "local-analysis.mjs");
  const localBundlePath = join(sequraiDir, "local-verdict-bundle.mjs");

  await downloadVerifiedFile(url, manifest?.bridge?.path ?? "/mcp/stdio-bridge.mjs", bridgePath, manifest?.bridge?.sha256 ?? null);
  await downloadVerifiedFile(
    url,
    manifest?.localAnalysis?.bundlePath ?? "/mcp/local-verdict-bundle.mjs",
    localBundlePath,
    manifest?.localAnalysis?.bundleSha256 ?? null
  );
  await downloadVerifiedFile(
    url,
    manifest?.localAnalysis?.path ?? "/mcp/local-analysis.mjs",
    localAnalysisPath,
    manifest?.localAnalysis?.sha256 ?? null
  );

  const envPath = writeSecureEnvFile(projectRoot, key, url);
  const gitignorePath = ensureGitignoreEntries(projectRoot);

  const cursorServer = cursorStdioServer(url, bridgePath, projectRoot);
  const claudeServer = httpServerEnvRef(url);

  const installed = [];

  const projectCursorPath = installAt(projectRoot, ".cursor/mcp.json", (existing) => ({
    ...existing,
    mcpServers: mergeServer(existing.mcpServers, SERVER_NAME, cursorServer),
  }));
  installed.push(`Cursor (project): ${projectCursorPath}`);

  if (scope === "global") {
    const globalCursorPath = installAt(home, ".cursor/mcp.json", (existing) => ({
      ...existing,
      mcpServers: mergeServer(existing.mcpServers, SERVER_NAME, cursorServer),
    }));
    installed.push(`Cursor (global): ${globalCursorPath}`);
  }

  const claudeProjectPath = installAt(projectRoot, ".mcp.json", (existing) => ({
    ...existing,
    mcpServers: mergeServer(existing.mcpServers, SERVER_NAME, claudeServer),
  }));
  installed.push(`Claude Code (project): ${claudeProjectPath}`);

  if (scope === "global") {
    const claudeGlobalPath = installAt(home, ".claude.json", (existing) => ({
      ...existing,
      mcpServers: mergeServer(existing.mcpServers, SERVER_NAME, claudeServer),
    }));
    installed.push(`Claude Code (global): ${claudeGlobalPath}`);
  }

  const vscodePath = installAt(projectRoot, ".vscode/mcp.json", (existing) => ({
    ...existing,
    servers: mergeServer(existing.servers, SERVER_NAME, claudeServer),
  }));
  installed.push(`VS Code (project): ${vscodePath}`);

  console.log("");
  console.log("SequrAI connected (project scope).");
  console.log("");
  console.log("Security:");
  console.log(`  • API key stored in: ${envPath} (never commit this file)`);
  console.log(`  • .gitignore updated: ${gitignorePath}`);
  console.log("  • Remote tools use GitHub-connected analysis; local tools run in the stdio bridge.");
  console.log("");
  console.log("Before starting your agent:");
  console.log(`  source ${envPath}`);
  console.log("");
  console.log("Next steps:");
  console.log("  Cursor:      quit fully → reopen → Settings → Tools & MCP → “sequrai” green");
  console.log("  Claude Code: source .sequrai/mcp.env → restart → /mcp");
  console.log("  Local:       ask “Analyze my current workspace” (stdio bridge local tools)");
  console.log("  Remote:      ask “Can I deploy?” (GitHub-connected Production Verdict)");
  console.log("");
  console.log("Installed:");
  for (const line of installed) {
    console.log(`  • ${line}`);
  }
  console.log(`  • Bridge: ${bridgePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Install failed");
  process.exit(1);
});
