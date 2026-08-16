#!/usr/bin/env node
/**
 * SequrAI MCP stdio bridge for Cursor / Claude Code.
 *
 * - Proxies remote MCP tools to the SequrAI HTTP API
 * - Executes local workspace tools without sending source code to the server
 *
 * Env:
 *   SEQURAI_API_KEY        — from environment or .sequrai/mcp.env
 *   SEQURAI_API_URL        — Base URL (default: https://sequrai-app.vercel.app)
 *   SEQURAI_WORKSPACE_ROOT — Authorized workspace root (default: cwd)
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import readline from "node:readline";
import {
  LOCAL_TOOL_NAMES,
  executeLocalTool,
  isLocalToolName,
} from "./local-analysis.mjs";

const DEFAULT_API_URL = "https://sequrai-app.vercel.app";

function loadDotEnvFile(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadProjectEnv() {
  const roots = [process.env.SEQURAI_WORKSPACE_ROOT, process.cwd()].filter(Boolean);
  for (const root of roots) {
    loadDotEnvFile(join(root, ".sequrai/mcp.env"));
  }
}

loadProjectEnv();

if (!process.env.SEQURAI_WORKSPACE_ROOT) {
  process.env.SEQURAI_WORKSPACE_ROOT = process.cwd();
}

const API_URL = (process.env.SEQURAI_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");
const API_KEY = process.env.SEQURAI_API_KEY?.trim() ?? "";
const WORKSPACE_ROOT = process.env.SEQURAI_WORKSPACE_ROOT;

function describeLocalTool(name) {
  if (name === "sequrai_local_status") {
    return "Local workspace status: branch, git state, snapshot limits, analysis readiness.";
  }
  if (name === "sequrai_local_audit" || name === "audit_local_project") {
    return "Audit the authorized local workspace and return the canonical Production Verdict (static local evidence; source: local).";
  }
  if (name === "sequrai_local_review") {
    return "Review local git changes (staged/unstaged) before commit.";
  }
  if (name === "sequrai_local_findings") {
    return "List actionable local findings (redacted; never sends raw secrets).";
  }
  return "Prepare a sanitized manifest of local files eligible for optional remote analysis.";
}

const LOCAL_TOOL_DEFINITIONS = LOCAL_TOOL_NAMES.map((name) => ({
  name,
  description: describeLocalTool(name),
  inputSchema: {
    type: "object",
    properties: {
      workspacePath: {
        type: "string",
        description: "Optional nested path inside the authorized workspace root.",
      },
      scope: {
        type: "string",
        enum: ["workspace", "working_tree", "staged", "diff"],
        description: "For local audit tools — which files to analyze.",
      },
      gitDiffOnly: {
        type: "boolean",
        description: "For sequrai_local_review / audit — unstaged diff only.",
      },
    },
    additionalProperties: false,
  },
}));

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function unauthorizedResponse(id) {
  send({
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: -32001,
      message:
        "SEQURAI_API_KEY is required. Run the SequrAI installer or source .sequrai/mcp.env.",
    },
  });
}

async function forwardToApi(body) {
  const response = await fetch(`${API_URL}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

function mergeToolLists(remoteTools) {
  const remote = Array.isArray(remoteTools) ? remoteTools : [];
  const names = new Set(remote.map((tool) => tool.name));
  const merged = [...remote];
  for (const tool of LOCAL_TOOL_DEFINITIONS) {
    if (!names.has(tool.name)) merged.push(tool);
  }
  return merged;
}

async function handleToolsList(message) {
  const remote = await forwardToApi(message);
  if (remote.error) {
    send(remote);
    return;
  }
  const tools = mergeToolLists(remote.result?.tools);
  send({ ...remote, result: { ...(remote.result ?? {}), tools } });
}

async function handleToolsCall(message) {
  const toolName = message.params?.name;
  const args = message.params?.arguments ?? {};

  if (!isLocalToolName(toolName)) {
    send(await forwardToApi(message));
    return;
  }

  try {
    const result = await executeLocalTool(toolName, args);
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      },
    });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32002,
        message: error instanceof Error ? error.message : "local_tool_failed",
      },
    });
  }
}

async function handleInitialize(message) {
  const remote = await forwardToApi(message);
  if (remote.error) {
    send(remote);
    return;
  }
  const instructions = [
    remote.result?.instructions ?? "",
    "",
    "Local audit tools analyze the authorized workspace on this machine only (source: local).",
    "Remote tools analyze GitHub-connected repositories (source: github).",
    "Use sequrai_local_audit or audit_local_project to audit before commit/push.",
  ]
    .filter(Boolean)
    .join("\n");
  send({
    ...remote,
    result: {
      ...(remote.result ?? {}),
      instructions,
    },
  });
}

async function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  const { id, method } = message;

  if (!API_KEY && method !== "notifications/initialized") {
    unauthorizedResponse(id);
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "initialize") {
    await handleInitialize(message);
    return;
  }

  if (method === "tools/list") {
    await handleToolsList(message);
    return;
  }

  if (method === "tools/call") {
    await handleToolsCall(message);
    return;
  }

  send(await forwardToApi(message));
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  void handleMessage(line.trim());
});
rl.on("close", () => process.exit(0));

process.stderr.write(`SequrAI MCP bridge → ${API_URL} | workspace ${WORKSPACE_ROOT}\n`);
