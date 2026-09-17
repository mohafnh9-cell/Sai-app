#!/usr/bin/env node
/**
 * Auto-Security MVP hook entrypoint -- invoked by the coding agent itself
 * (Claude Code's PostToolUse/Stop hooks, Cursor's afterFileEdit/stop
 * hooks), never by a daemon or persistent process. Each invocation is a
 * short-lived subprocess that reads one JSON payload from stdin and exits.
 *
 * This script contains NO scanning/classification/persistence logic of its
 * own -- it only adapts each agent's own hook payload shape into calls
 * against lib/local-analysis's existing auto-security-trigger.ts
 * (recordChangedPath / evaluateAutoSecurityTrigger / formatAutoSecurityFeedback),
 * bundled the same way every other local tool already is
 * (./local-analysis.mjs -> ../public/mcp/local-verdict-bundle.mjs).
 *
 * Two payload shapes are supported (both documented, real, current):
 *  - Claude Code: hook_event_name is "PostToolUse" (tool_name/tool_input.file_path)
 *    or "Stop" (no tool fields).
 *  - Cursor: no explicit "PostToolUse"/"Stop" name; afterFileEdit payloads
 *    carry file_path/edits directly, stop payloads carry a `status` field.
 *
 * Env:
 *   SEQURAI_WORKSPACE_ROOT — overrides the workspace root; otherwise the
 *     payload's own cwd/workspace_roots is used, matching every other local
 *     tool's own resolution order (see lib/local-analysis/local-tool-handlers.ts).
 */

import { relative, isAbsolute } from "node:path";
import { recordChangedPath, evaluateAutoSecurityTrigger, formatAutoSecurityFeedback } from "./local-analysis.mjs";

const EDIT_TOOL_NAMES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    // Hooks always receive a payload; a hung stdin (no agent actually
    // connected, e.g. manual testing) must not hang this process forever.
    setTimeout(() => resolve(data), 5000).unref();
  });
}

function resolveWorkspaceRoot(input) {
  if (process.env.SEQURAI_WORKSPACE_ROOT) return process.env.SEQURAI_WORKSPACE_ROOT;
  if (typeof input.cwd === "string" && input.cwd) return input.cwd;
  if (Array.isArray(input.workspace_roots) && input.workspace_roots[0]) return input.workspace_roots[0];
  return process.cwd();
}

/** Never records a path outside the resolved workspace root -- defense in depth even though recordChangedPath's own consumer (the classifier) never touches the filesystem at that path. */
function toSafeRelativePath(workspaceRoot, absolutePath) {
  if (!absolutePath || typeof absolutePath !== "string") return null;
  const target = isAbsolute(absolutePath) ? absolutePath : `${workspaceRoot}/${absolutePath}`;
  const rel = relative(workspaceRoot, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel;
}

function isStopLikeEvent(input) {
  if (input.hook_event_name === "Stop") return true; // Claude Code
  if (typeof input.status === "string" && ["completed", "aborted", "error"].includes(input.status)) return true; // Cursor
  return false;
}

function isEditLikeEvent(input) {
  if (input.hook_event_name === "PostToolUse") return true; // Claude Code (tool filtered below)
  if (typeof input.file_path === "string" && Array.isArray(input.edits)) return true; // Cursor afterFileEdit
  return false;
}

async function main() {
  const raw = await readStdin();
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }

  const workspaceRoot = resolveWorkspaceRoot(input);

  try {
    if (isEditLikeEvent(input)) {
      if (input.hook_event_name === "PostToolUse") {
        if (!EDIT_TOOL_NAMES.has(input.tool_name)) {
          process.exit(0);
        }
        const filePath = input.tool_input?.file_path;
        const relPath = toSafeRelativePath(workspaceRoot, filePath);
        if (relPath) recordChangedPath(workspaceRoot, relPath);
      } else {
        const relPath = toSafeRelativePath(workspaceRoot, input.file_path);
        if (relPath) recordChangedPath(workspaceRoot, relPath);
      }
      process.exit(0);
    }

    if (isStopLikeEvent(input)) {
      const decision = await evaluateAutoSecurityTrigger(workspaceRoot);
      if (decision.action === "triggered") {
        const feedback = formatAutoSecurityFeedback(decision);
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: { hookEventName: "Stop", additionalContext: feedback, systemMessage: feedback },
            followup_message: feedback,
          })
        );
      }
      process.exit(0);
    }
  } catch (error) {
    // A hook failure must NEVER block or crash the agent's turn -- report
    // to stderr (visible in Claude Code/Cursor's own hook debug output) and
    // exit 0 (non-blocking) either way.
    process.stderr.write(`SequrAI Auto-Security hook error: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  process.exit(0);
}

void main();
