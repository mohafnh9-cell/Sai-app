import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifySecurityRelevance, type SecurityRelevanceResult } from "./auto-security-classifier";
import { getGitContext } from "./git-scope";
import { runLocalProductionVerdict } from "./run-local-verdict";
import type { LocalProductionVerdictResult } from "./types";
import { isDescendantPath, normalizeWorkspaceRoot, realpathResolved } from "./workspace";

/**
 * Auto-Security MVP -- the trigger/automation layer only. This module
 * invents NO new scanner, orchestrator, persistence, or verdict logic: the
 * only security-executing call anywhere in this file is
 * runLocalProductionVerdict() (run-local-verdict.ts), the exact same
 * canonical entry point sequrai_local_audit already uses -- which itself
 * delegates to the existing local orchestrator (F9). There is exactly one
 * security execution path in SequrAI; this file only decides WHEN to call
 * it.
 *
 * Architecture (per the master prompt's own diagram):
 *   agent tool-use / stop event (mcp/auto-security-hook.mjs)
 *     -> recordChangedPath()          [PostToolUse / afterFileEdit]
 *     -> evaluateAutoSecurityTrigger() [Stop]
 *          -> classifySecurityRelevance() (deterministic, no AI)
 *          -> runLocalProductionVerdict() (existing canonical path, only if relevant + state actually changed)
 *
 * Coalescing without a daemon: PostToolUse/afterFileEdit hooks are cheap
 * and only append a path to a small state file -- no scan runs there. The
 * actual scan only ever runs from the Stop event, which fires exactly once
 * per agent turn no matter how many edits happened within it. This is the
 * "many agent events -> few meaningful security reviews" property without
 * any timer, polling loop, or background process.
 *
 * Duplicate-scan prevention: a fingerprint of (commitSha + git status text)
 * is compared against the fingerprint recorded at the last AUTO-triggered
 * scan. If nothing in the git-visible state actually changed since then
 * (e.g. a duplicate Stop event, or edits that were reverted before the
 * agent stopped), no second scan runs -- reusing the SAME identity signal
 * (commitSha/dirty state) already used elsewhere in this codebase for
 * "what changed" reasoning, not a new dedup mechanism.
 */

const STATE_DIRNAME = ".sequrai";
const STATE_FILENAME = "auto-security-state.json";
const MAX_PENDING_PATHS = 200;

export type AutoSecurityState = {
  pendingPaths: string[];
  lastTriggerFingerprint: string | null;
  lastTriggerAt: string | null;
  lastTriggerScanId: string | null;
};

/**
 * Always returns a fresh object with a fresh `pendingPaths` array -- never
 * a shared module-level constant. A prior version of this file returned
 * `{ ...EMPTY_STATE }` from a single shared constant, which shallow-copies
 * the top-level object but NOT the nested `pendingPaths` array; every
 * caller that then pushed onto "their own" empty state was actually
 * mutating the one shared array, corrupting state across every workspace
 * that had never yet written its own state file. Caught by the workspace-
 * isolation regression test below.
 */
function freshEmptyState(): AutoSecurityState {
  return {
    pendingPaths: [],
    lastTriggerFingerprint: null,
    lastTriggerAt: null,
    lastTriggerScanId: null,
  };
}

/**
 * Symlink-safe resolution of .sequrai/auto-security-state.json, mirroring
 * local-persistence.ts's resolveSecureDatabasePath -- the same defense
 * (refuse a symlinked .sequrai directory or state file) applied to this
 * second small coordination file rather than a bespoke check.
 */
function resolveStatePath(workspaceRoot: string): string {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const rootReal = realpathResolved(root);
  const dir = join(rootReal, STATE_DIRNAME);

  if (existsSync(dir)) {
    const dirStat = lstatSync(dir);
    if (dirStat.isSymbolicLink()) {
      throw new Error("Refusing to use a symlinked .sequrai directory.");
    }
    const dirReal = realpathResolved(dir);
    if (!isDescendantPath(rootReal, dirReal)) {
      throw new Error("Refusing a .sequrai directory outside the workspace.");
    }
  } else {
    mkdirSync(dir, { recursive: true });
  }

  const statePath = join(dir, STATE_FILENAME);
  if (existsSync(statePath) && lstatSync(statePath).isSymbolicLink()) {
    throw new Error("Refusing a symlinked auto-security state file.");
  }
  return statePath;
}

function readState(workspaceRoot: string): AutoSecurityState {
  try {
    const path = resolveStatePath(workspaceRoot);
    if (!existsSync(path)) return freshEmptyState();
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AutoSecurityState>;
    return {
      pendingPaths: Array.isArray(raw.pendingPaths) ? raw.pendingPaths.filter((p) => typeof p === "string") : [],
      lastTriggerFingerprint: typeof raw.lastTriggerFingerprint === "string" ? raw.lastTriggerFingerprint : null,
      lastTriggerAt: typeof raw.lastTriggerAt === "string" ? raw.lastTriggerAt : null,
      lastTriggerScanId: typeof raw.lastTriggerScanId === "string" ? raw.lastTriggerScanId : null,
    };
  } catch {
    // A corrupt/unreadable state file is never fatal -- worst case, one
    // extra review runs because coalescing state was lost. Never silently
    // skip a review because state couldn't be read.
    return freshEmptyState();
  }
}

/**
 * Pilot hardening: writes via a temp-file-then-rename instead of a direct
 * writeFileSync -- a hook process that gets killed mid-write (a real
 * scenario: the agent process itself can be interrupted, taking this
 * short-lived subprocess down with it) previously risked leaving a
 * truncated/corrupt JSON file. rename() is atomic on the same filesystem,
 * so readers only ever see the old complete file or the new complete file,
 * never a partial one. A corrupt read is still handled gracefully by
 * readState's own catch (never fatal), but avoiding the corruption in the
 * first place is strictly better.
 */
function writeState(workspaceRoot: string, state: AutoSecurityState): void {
  const path = resolveStatePath(workspaceRoot);
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmpPath, path);
}

/**
 * Called from the PostToolUse (Claude Code) / afterFileEdit (Cursor) hook
 * for every file-editing tool call. Cheap and side-effect-free beyond
 * recording the path -- never runs a scan.
 */
export function recordChangedPath(workspaceRoot: string, relativePath: string): void {
  if (!relativePath) return;
  const state = readState(workspaceRoot);
  if (!state.pendingPaths.includes(relativePath)) {
    state.pendingPaths.push(relativePath);
    if (state.pendingPaths.length > MAX_PENDING_PATHS) {
      state.pendingPaths = state.pendingPaths.slice(-MAX_PENDING_PATHS);
    }
  }
  writeState(workspaceRoot, state);
}

function computeGitStateFingerprint(git: { commitSha: string | null; status: string | null }): string {
  return createHash("sha256").update(`${git.commitSha ?? ""}\n${git.status ?? ""}`).digest("hex");
}

export type AutoSecurityDecision =
  | { action: "skipped"; reason: string; classification?: SecurityRelevanceResult }
  | { action: "triggered"; reason: string; classification: SecurityRelevanceResult; result: LocalProductionVerdictResult };

/**
 * Called from the Stop (Claude Code) / stop (Cursor) hook -- the ONE point
 * per agent turn where a review may actually run, regardless of how many
 * edits happened during that turn.
 */
export async function evaluateAutoSecurityTrigger(workspacePath: string): Promise<AutoSecurityDecision> {
  const workspace = normalizeWorkspaceRoot(workspacePath);
  const state = readState(workspace);

  if (state.pendingPaths.length === 0) {
    return { action: "skipped", reason: "No recorded file changes since the last check." };
  }

  const classification = classifySecurityRelevance(state.pendingPaths);
  if (!classification.relevant) {
    writeState(workspace, { ...state, pendingPaths: [] });
    return { action: "skipped", reason: classification.reason, classification };
  }

  const git = getGitContext(workspace);
  const fingerprint = computeGitStateFingerprint(git);
  if (state.lastTriggerFingerprint && fingerprint === state.lastTriggerFingerprint) {
    writeState(workspace, { ...state, pendingPaths: [] });
    return {
      action: "skipped",
      reason: "No net change in git state since the last automatic review -- avoiding a duplicate scan.",
      classification,
    };
  }

  const result = await runLocalProductionVerdict({ workspacePath: workspace, scope: "workspace", persist: true });

  writeState(workspace, {
    pendingPaths: [],
    lastTriggerFingerprint: fingerprint,
    lastTriggerAt: new Date().toISOString(),
    lastTriggerScanId: result.persistence?.status === "saved" ? result.persistence.scanId : null,
  });

  return { action: "triggered", reason: classification.reason, classification, result };
}

/** Exposed for tests and for the hook script's own diagnostics -- never mutates anything. */
export function readAutoSecurityState(workspaceRoot: string): AutoSecurityState {
  return readState(workspaceRoot);
}

/**
 * A short, agent-facing summary of an auto-security decision -- reuses the
 * SAME fields sequrai_local_audit's own MCP response already exposes
 * (verdictStatus/score/findings), not a new response shape. Deliberately
 * never claims "secure"/"verified"/"safe"; "not detected" stays distinct
 * from "verified" per the product's own language rules (see
 * lib/local-analysis/run-local-verdict.ts's history note for the same
 * wording precedent).
 */
export function formatAutoSecurityFeedback(decision: AutoSecurityDecision): string {
  if (decision.action === "skipped") {
    return `SequrAI Auto-Security: no review triggered (${decision.reason})`;
  }

  const { result } = decision;
  const phaseLabel =
    result.phase === "complete"
      ? "REVIEW COMPLETE"
      : result.phase === "partial"
        ? "REVIEW PARTIAL"
        : result.phase === "cancelled"
          ? "REVIEW CANCELLED"
          : "REVIEW INCOMPLETE";

  const blockingFindings = result.findings.filter((f) => f.severity === "critical" || f.severity === "high");
  const lines = [
    `SequrAI Auto-Security: ${phaseLabel}`,
    `Verdict: ${result.verdictStatus}${result.score != null ? ` (${result.score}/100)` : ""}`,
    `Findings: ${result.findings.length} total, ${blockingFindings.length} critical/high.`,
  ];

  if (result.phase === "partial" || result.phase === "incomplete") {
    const failedEngines = result.engines.filter((e) => e.status === "FAILED" || e.status === "PARTIAL");
    if (failedEngines.length > 0) {
      lines.push(`Note: ${failedEngines.map((e) => `${e.engine} (${e.status})`).join(", ")} did not complete -- absence of findings from them is not evidence of safety.`);
    }
  }

  for (const finding of blockingFindings.slice(0, 3)) {
    lines.push(`- ${finding.severity.toUpperCase()} ${finding.title} (${finding.filePath ?? "no single file"}${finding.line != null ? `:${finding.line}` : ""})`);
  }

  return lines.join("\n");
}
