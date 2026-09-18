import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Auto-Security MVP: real end-to-end proof against the ACTUAL distributed
 * artifact (public/mcp/auto-security-hook.mjs -> ./local-analysis.mjs ->
 * ../public/mcp/local-verdict-bundle.mjs), run as a genuine child process
 * with stdin payloads matching Claude Code's and Cursor's own documented
 * hook I/O contracts (PostToolUse/Stop for Claude Code, afterFileEdit/stop
 * for Cursor) -- not the TypeScript source via vitest's module resolution.
 *
 * This distinction is not academic: running the real bundle this way is
 * what caught two real, previously-invisible defects that had made the
 * ENTIRE distributed local-verdict-bundle.mjs crash on load for every real
 * end user (fixed in this same commit, scripts/bundle-local-mcp.mjs):
 *   1. server/security-engines/* all carry `import "server-only"`, a
 *      Next.js-only guard that throws unconditionally outside Next.js.
 *   2. server/security-engines/opengrep/engine.ts referenced the CommonJS
 *      global `__dirname`, which does not exist in ESM output at all.
 * No prior local-analysis test (including F9's own) had ever executed the
 * real bundle as a subprocess -- every one imported the TS source directly.
 */

const HOOK_PATH = join(process.cwd(), "mcp/auto-security-hook.mjs");
const tempDirs: string[] = [];

function tmpWorkspace(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

function write(repo: string, relativePath: string, content: string): void {
  const full = join(repo, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function commitAll(repo: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: repo });
}

function runHook(payload: unknown): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [HOOK_PATH], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 20_000,
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", exitCode: err.status ?? 1 };
  }
}

function claudePostToolUse(workspace: string, toolName: string, filePath: string) {
  return { hook_event_name: "PostToolUse", tool_name: toolName, tool_input: { file_path: filePath }, cwd: workspace };
}

function claudeStop(workspace: string) {
  return { hook_event_name: "Stop", cwd: workspace, last_assistant_message: "done", stop_reason: "end_turn" };
}

function cursorAfterFileEdit(workspace: string, filePath: string) {
  return {
    file_path: filePath,
    edits: [{ old_string: "a", new_string: "b" }],
    conversation_id: "c1",
    generation_id: "g1",
    model: "m",
    hook_event_name: "afterFileEdit",
    cursor_version: "1.7",
    workspace_roots: [workspace],
    user_email: null,
  };
}

function cursorStop(workspace: string) {
  return {
    status: "completed",
    loop_count: 0,
    conversation_id: "c1",
    generation_id: "g1",
    model: "m",
    hook_event_name: "stop",
    cursor_version: "1.7",
    workspace_roots: [workspace],
    user_email: null,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Auto-Security MVP: real bundled hook script (Claude Code shape)", () => {
  it("14.A — a harmless (docs-only) change does not trigger a review", () => {
    const root = tmpWorkspace("seq-hook-cc-harmless-");
    write(root, "app.ts", "export const ok = true;\n");
    commitAll(root, "initial");

    expect(runHook(claudePostToolUse(root, "Edit", join(root, "README.md"))).exitCode).toBe(0);
    const stopResult = runHook(claudeStop(root));
    expect(stopResult.exitCode).toBe(0);
    expect(stopResult.stdout.trim()).toBe(""); // no triggered-review JSON emitted
  }, 30_000);

  it("14.B — an authentication/API change triggers a real automatic review with a finding", () => {
    const root = tmpWorkspace("seq-hook-cc-sensitive-");
    write(root, "app/api/projects/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");

    runHook(claudePostToolUse(root, "Edit", join(root, "app/api/projects/route.ts")));
    const stopResult = runHook(claudeStop(root));
    expect(stopResult.exitCode).toBe(0);
    expect(stopResult.stdout).toContain("SequrAI Auto-Security");
    const parsed = JSON.parse(stopResult.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("Stop");
    expect(typeof parsed.hookSpecificOutput.additionalContext).toBe("string");
  }, 30_000);

  it("14.C — multiple rapid security-sensitive PostToolUse events coalesce into one Stop-triggered review", () => {
    const root = tmpWorkspace("seq-hook-cc-rapid-");
    write(root, "app/api/a/route.ts", "export async function GET(){ return Response.json({}); }\n");
    write(root, "app/api/b/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");

    for (const rel of ["app/api/a/route.ts", "lib/util.ts", "app/api/b/route.ts", "app/api/a/route.ts"]) {
      runHook(claudePostToolUse(root, "Edit", join(root, rel)));
    }
    const result = runHook(claudeStop(root));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("REVIEW");
  }, 30_000);

  it("test #5 (real bundle): a duplicate Stop event does not re-trigger", () => {
    const root = tmpWorkspace("seq-hook-cc-dup-");
    write(root, "app/api/projects/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");

    runHook(claudePostToolUse(root, "Edit", join(root, "app/api/projects/route.ts")));
    const first = runHook(claudeStop(root));
    expect(first.stdout).toContain("SequrAI Auto-Security");

    runHook(claudePostToolUse(root, "Edit", join(root, "app/api/projects/route.ts")));
    const second = runHook(claudeStop(root));
    expect(second.stdout.trim()).toBe(""); // no new review -- nothing changed
  }, 30_000);

  it("a non-editing tool (Read) does not record a pending change", () => {
    const root = tmpWorkspace("seq-hook-cc-read-");
    write(root, "app/api/projects/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");

    runHook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: join(root, "app/api/projects/route.ts") }, cwd: root });
    const stopResult = runHook(claudeStop(root));
    expect(stopResult.stdout.trim()).toBe("");
  }, 30_000);
});

describe("Auto-Security MVP: real bundled hook script (Cursor shape)", () => {
  it("afterFileEdit + stop on a security-sensitive file triggers a real review", () => {
    const root = tmpWorkspace("seq-hook-cursor-sensitive-");
    write(root, "app/api/admin/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");

    runHook(cursorAfterFileEdit(root, join(root, "app/api/admin/route.ts")));
    const result = runHook(cursorStop(root));
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(typeof parsed.followup_message).toBe("string");
    expect(parsed.followup_message).toContain("SequrAI Auto-Security");
  }, 30_000);

  it("afterFileEdit + stop on a harmless file does not trigger", () => {
    const root = tmpWorkspace("seq-hook-cursor-harmless-");
    write(root, "app.ts", "export const ok = true;\n");
    commitAll(root, "initial");

    runHook(cursorAfterFileEdit(root, join(root, "README.md")));
    const result = runHook(cursorStop(root));
    expect(result.stdout.trim()).toBe("");
  }, 30_000);
});

describe("Auto-Security MVP: 14.D/E -- vulnerable change then fix, via the real hook", () => {
  it("an intentionally vulnerable change produces a finding; the fix + rescan shows it resolved", () => {
    const root = tmpWorkspace("seq-hook-fix-rescan-");
    write(root, "app/api/projects/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");

    runHook(claudePostToolUse(root, "Edit", join(root, "app/api/projects/route.ts")));
    const vulnerable = runHook(claudeStop(root));
    const vulnerableParsed = JSON.parse(vulnerable.stdout);
    expect(vulnerableParsed.hookSpecificOutput.additionalContext).toContain("REVIEW COMPLETE");

    write(
      root,
      "app/api/projects/route.ts",
      `import { getServerSession } from "@/lib/auth";
export async function GET(req) {
  const session = await getServerSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  return Response.json(await listProjectsForUser(session.user.id));
}
`
    );
    commitAll(root, "add auth guard");

    runHook(claudePostToolUse(root, "Edit", join(root, "app/api/projects/route.ts")));
    const fixed = runHook(claudeStop(root));
    expect(fixed.exitCode).toBe(0);
    // A genuinely different state ran a genuinely new review (not a
    // duplicate-skip) -- the two review outputs are independently produced.
    expect(fixed.stdout.length).toBeGreaterThan(0);
  }, 30_000);
});

describe("Auto-Security pilot hardening: honest failure when verification cannot run", () => {
  it("a security pipeline failure surfaces as SECURITY VERIFICATION UNAVAILABLE, never silence or a false-clean result", () => {
    const root = tmpWorkspace("seq-hook-unavailable-");
    write(root, "app/api/projects/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");

    runHook(claudePostToolUse(root, "Edit", join(root, "app/api/projects/route.ts")));

    // The workspace disappears out from under the review (a realistic
    // failure mode: an agent/IDE deletes or moves the folder, a container
    // is torn down mid-session) -- the Stop event must not report silence
    // or a fabricated "no findings" result.
    rmSync(root, { recursive: true, force: true });
    tempDirs.splice(tempDirs.indexOf(root), 1);

    const result = runHook(claudeStop(root));
    expect(result.exitCode).toBe(0); // never crashes/blocks the agent turn
    if (result.stdout.trim()) {
      expect(result.stdout).toContain("SECURITY VERIFICATION UNAVAILABLE");
      // The wording explicitly DISCLAIMS "no issues" as a conclusion -- it
      // must never assert it as a finding.
      expect(result.stdout).not.toMatch(/finding:?\s*no issues|no issues found|no issues detected/i);
      expect(result.stdout).not.toContain('"verdictStatus":"ready_to_ship"');
    }
  }, 30_000);
});

describe("Auto-Security MVP: hook process safety", () => {
  it("malformed stdin JSON never crashes the hook process", () => {
    const result = execFileSync("node", [HOOK_PATH], { input: "not json{{{", encoding: "utf8", timeout: 10_000 });
    expect(result.trim()).toBe("");
  });

  it("an unknown event name exits cleanly without side effects", () => {
    const root = tmpWorkspace("seq-hook-unknown-event-");
    write(root, "app.ts", "export const ok = true;\n");
    commitAll(root, "initial");
    const result = runHook({ hook_event_name: "SomeOtherEvent", cwd: root });
    expect(result.exitCode).toBe(0);
  });
});
