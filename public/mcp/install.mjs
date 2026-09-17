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

// ==================================================================
// Auto-Security hook installation (Claude Code .claude/settings.json,
// Cursor .cursor/hooks.json).
//
// Ownership/idempotency: neither file's hook array has a natural key the
// way mcpServers does (mergeServer above keys on the "sequrai" server
// name) -- both are plain arrays of hook definitions. The hook's own
// `command` string, which always points at THIS installer's fixed
// destination path for auto-security-hook.mjs, is used as the stable
// identity marker instead: a hook entry is "SequrAI-owned" if and only if
// its command references that exact path. This is not a new metadata
// mechanism -- it reuses the one piece of the hook entry that is already
// guaranteed unique and installer-controlled.
// ==================================================================

const AUTO_SECURITY_HOOK_MARKER = "auto-security-hook.mjs";

function isSequraiHookEntry(entry) {
  return Boolean(entry) && typeof entry.command === "string" && entry.command.includes(AUTO_SECURITY_HOOK_MARKER);
}

/**
 * Claude Code's settings.json shape: an array of {matcher, hooks: [...]}
 * groups per event. Idempotently ensures exactly one SequrAI-owned group
 * exists -- a re-run replaces SequrAI's own group in place (picking up an
 * updated command/timeout) rather than appending a second one, and every
 * group that isn't SequrAI's own (a user's own hooks) is left untouched.
 */
function mergeClaudeCodeHookGroups(existingGroups, matcher, hookDefinition) {
  const groups = Array.isArray(existingGroups) ? [...existingGroups] : [];
  const ownedGroupIndex = groups.findIndex((group) => Array.isArray(group?.hooks) && group.hooks.some(isSequraiHookEntry));
  const newGroup = matcher !== undefined ? { matcher, hooks: [hookDefinition] } : { hooks: [hookDefinition] };

  if (ownedGroupIndex === -1) {
    groups.push(newGroup);
    return groups;
  }
  groups[ownedGroupIndex] = newGroup;
  return groups;
}

function removeSequraiClaudeCodeHookGroups(existingGroups) {
  const groups = Array.isArray(existingGroups) ? existingGroups : [];
  return groups.filter((group) => !(Array.isArray(group?.hooks) && group.hooks.some(isSequraiHookEntry)));
}

/**
 * Cursor's hooks.json shape: a flat array of hook definitions per event
 * (no matcher grouping). Idempotently ensures exactly one SequrAI-owned
 * entry exists, preserving every other entry.
 */
function mergeCursorHookEntries(existingEntries, hookDefinition) {
  const entries = Array.isArray(existingEntries) ? existingEntries.filter((entry) => !isSequraiHookEntry(entry)) : [];
  entries.push(hookDefinition);
  return entries;
}

function removeSequraiCursorHookEntries(existingEntries) {
  const entries = Array.isArray(existingEntries) ? existingEntries : [];
  return entries.filter((entry) => !isSequraiHookEntry(entry));
}

function claudeCodeAutoSecurityHooks(hookPath) {
  return {
    postToolUse: { type: "command", command: `node "${hookPath}"`, timeout: 10 },
    stop: { type: "command", command: `node "${hookPath}"`, timeout: 120 },
  };
}

function cursorAutoSecurityHooks(hookPath) {
  return {
    afterFileEdit: { command: `node "${hookPath}"`, type: "command", timeout: 10, failClosed: false },
    stop: { command: `node "${hookPath}"`, timeout: 120 },
  };
}

/**
 * Merges SequrAI's Auto-Security hooks into the project's
 * .claude/settings.json and .cursor/hooks.json, preserving every existing
 * entry (SequrAI's own or the user's). Safe to call on every install run --
 * a second run updates SequrAI's own entries in place rather than
 * duplicating them.
 */
function installAutoSecurityHooks(projectRoot, hookPath) {
  const claudeHooks = claudeCodeAutoSecurityHooks(hookPath);
  const claudeSettingsPath = installAt(projectRoot, ".claude/settings.json", (existing) => {
    const hooks = existing.hooks && typeof existing.hooks === "object" ? { ...existing.hooks } : {};
    hooks.PostToolUse = mergeClaudeCodeHookGroups(hooks.PostToolUse, "Edit|Write|MultiEdit|NotebookEdit", claudeHooks.postToolUse);
    hooks.Stop = mergeClaudeCodeHookGroups(hooks.Stop, undefined, claudeHooks.stop);
    return { ...existing, hooks };
  });

  const cursorHooks = cursorAutoSecurityHooks(hookPath);
  const cursorHooksPath = installAt(projectRoot, ".cursor/hooks.json", (existing) => {
    const hooks = existing.hooks && typeof existing.hooks === "object" ? { ...existing.hooks } : {};
    hooks.afterFileEdit = mergeCursorHookEntries(hooks.afterFileEdit, cursorHooks.afterFileEdit);
    hooks.stop = mergeCursorHookEntries(hooks.stop, cursorHooks.stop);
    return { version: existing.version ?? 1, ...existing, hooks };
  });

  return { claudeSettingsPath, cursorHooksPath };
}

/** Removes ONLY SequrAI-owned Auto-Security hook entries; every other configured hook is left exactly as the user had it. */
function uninstallAutoSecurityHooks(projectRoot) {
  const removed = [];

  const claudeSettingsPath = join(projectRoot, ".claude/settings.json");
  const claudeSettings = readJson(claudeSettingsPath);
  if (claudeSettings?.hooks) {
    const hooks = { ...claudeSettings.hooks };
    let changed = false;
    for (const eventName of ["PostToolUse", "Stop"]) {
      if (!hooks[eventName]) continue;
      const before = JSON.stringify(hooks[eventName]);
      hooks[eventName] = removeSequraiClaudeCodeHookGroups(hooks[eventName]);
      if (JSON.stringify(hooks[eventName]) !== before) changed = true;
    }
    if (changed) {
      writeJson(claudeSettingsPath, { ...claudeSettings, hooks });
      removed.push(claudeSettingsPath);
    }
  }

  const cursorHooksPath = join(projectRoot, ".cursor/hooks.json");
  const cursorHooks = readJson(cursorHooksPath);
  if (cursorHooks?.hooks) {
    const hooks = { ...cursorHooks.hooks };
    let changed = false;
    for (const eventName of ["afterFileEdit", "stop"]) {
      if (!Array.isArray(hooks[eventName])) continue;
      const before = JSON.stringify(hooks[eventName]);
      hooks[eventName] = removeSequraiCursorHookEntries(hooks[eventName]);
      if (JSON.stringify(hooks[eventName]) !== before) changed = true;
    }
    if (changed) {
      writeJson(cursorHooksPath, { ...cursorHooks, hooks });
      removed.push(cursorHooksPath);
    }
  }

  return removed;
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

  const autoSecurityHookPath = join(sequraiDir, "auto-security-hook.mjs");
  await downloadVerifiedFile(
    url,
    manifest?.autoSecurityHook?.path ?? "/mcp/auto-security-hook.mjs",
    autoSecurityHookPath,
    manifest?.autoSecurityHook?.sha256 ?? null
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

  const { claudeSettingsPath, cursorHooksPath } = installAutoSecurityHooks(projectRoot, autoSecurityHookPath);
  installed.push(`Auto-Security (Claude Code hooks): ${claudeSettingsPath}`);
  installed.push(`Auto-Security (Cursor hooks): ${cursorHooksPath}`);

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

/**
 * `node install.mjs --uninstall` removes ONLY SequrAI's own Auto-Security
 * hook entries (see uninstallAutoSecurityHooks's own ownership doc
 * comment). Deliberately does not touch .cursor/mcp.json, .mcp.json,
 * .vscode/mcp.json, or .sequrai/mcp.env -- MCP server removal and secret
 * cleanup are a separate, already-reversible-by-editing-JSON concern; this
 * flag's job is narrowly the hook entries a user cannot safely hand-edit
 * without risking deleting their own unrelated hooks.
 */
function uninstallMain() {
  const projectRoot = process.cwd();
  const removed = uninstallAutoSecurityHooks(projectRoot);
  if (removed.length === 0) {
    console.log("No SequrAI Auto-Security hooks were found to remove.");
    return;
  }
  console.log("Removed SequrAI Auto-Security hooks from:");
  for (const path of removed) {
    console.log(`  • ${path}`);
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  if (process.argv.includes("--uninstall")) {
    uninstallMain();
  } else {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : "Install failed");
      process.exit(1);
    });
  }
}

export {
  isSequraiHookEntry,
  mergeClaudeCodeHookGroups,
  removeSequraiClaudeCodeHookGroups,
  mergeCursorHookEntries,
  removeSequraiCursorHookEntries,
  claudeCodeAutoSecurityHooks,
  cursorAutoSecurityHooks,
  installAutoSecurityHooks,
  uninstallAutoSecurityHooks,
  mergeServer,
  installAt,
  readJson,
  writeJson,
};
