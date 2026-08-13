#!/usr/bin/env node
/**
 * SequrAI MCP stdio bridge for Cursor / Claude Code.
 *
 * Speaks MCP JSON-RPC over stdin/stdout and forwards tool calls to the SequrAI HTTP API.
 *
 * Env:
 *   SEQURAI_API_KEY  — MCP API key from Settings (required)
 *   SEQURAI_API_URL  — Base URL (default: https://sequrai-app.vercel.app)
 */

import readline from "node:readline";

const API_URL = (process.env.SEQURAI_API_URL ?? "https://sequrai-app.vercel.app").replace(/\/$/, "");
const API_KEY = process.env.SEQURAI_API_KEY;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function unauthorizedResponse(id) {
  send({
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: -32001,
      message: "SEQURAI_API_KEY is required. Generate one in SequrAI Settings → MCP Integration.",
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
    const response = await forwardToApi(message);
    send(response);
    return;
  }

  const response = await forwardToApi(message);
  send(response);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  void handleMessage(line.trim());
});
rl.on("close", () => process.exit(0));

process.stderr.write(`SequrAI MCP bridge → ${API_URL}\n`);
