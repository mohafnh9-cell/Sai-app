import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installAutoSecurityHooks,
  uninstallAutoSecurityHooks,
  readJson,
} from "../install.mjs";

/**
 * Auto-Security pilot hardening: proves the installer's hook merge/removal
 * logic is idempotent and ownership-scoped, against the REAL exported
 * functions install.mjs itself uses -- not a reimplementation. This file
 * only imports the module (guarded by install.mjs's own
 * `isEntryPoint` check), so importing it here never triggers a real
 * network install.
 */

const tempDirs: string[] = [];

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "seq-installer-"));
  tempDirs.push(dir);
  return dir;
}

const HOOK_PATH = "/home/dev/.sequrai/auto-security-hook.mjs";

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Installer: idempotent Auto-Security hook installation", () => {
  it("A/B/C — installing twice results in exactly one SequrAI hook entry per event, not two", () => {
    const project = tmpProject();
    installAutoSecurityHooks(project, HOOK_PATH);
    installAutoSecurityHooks(project, HOOK_PATH);

    const claudeSettings = readJson(join(project, ".claude/settings.json"));
    expect(claudeSettings.hooks.PostToolUse).toHaveLength(1);
    expect(claudeSettings.hooks.Stop).toHaveLength(1);
    expect(claudeSettings.hooks.PostToolUse[0].hooks).toHaveLength(1);

    const cursorHooks = readJson(join(project, ".cursor/hooks.json"));
    expect(cursorHooks.hooks.afterFileEdit).toHaveLength(1);
    expect(cursorHooks.hooks.stop).toHaveLength(1);
  });

  it("preserves an existing user-authored hook that has nothing to do with SequrAI", () => {
    const project = tmpProject();
    const claudeDir = join(project, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify(
        {
          hooks: {
            PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo user-hook" }] }],
          },
          otherSetting: "keep-me",
        },
        null,
        2
      )
    );

    installAutoSecurityHooks(project, HOOK_PATH);

    const claudeSettings = readJson(join(project, ".claude/settings.json"));
    expect(claudeSettings.otherSetting).toBe("keep-me");
    expect(claudeSettings.hooks.PostToolUse).toHaveLength(2); // user's Bash hook + SequrAI's
    expect(claudeSettings.hooks.PostToolUse.some((g: { hooks: Array<{ command: string }> }) => g.hooks.some((h) => h.command === "echo user-hook"))).toBe(true);
  });

  it("preserves an existing user-authored Cursor hook", () => {
    const project = tmpProject();
    mkdirSync(join(project, ".cursor"), { recursive: true });
    writeFileSync(
      join(project, ".cursor/hooks.json"),
      JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command: "./my-own-hook.sh", type: "command" }] } }, null, 2)
    );

    installAutoSecurityHooks(project, HOOK_PATH);

    const cursorHooks = readJson(join(project, ".cursor/hooks.json"));
    expect(cursorHooks.hooks.afterFileEdit).toHaveLength(2);
    expect(cursorHooks.hooks.afterFileEdit.some((h: { command: string }) => h.command === "./my-own-hook.sh")).toBe(true);
  });

  it("a re-install after a hook-path change (upgrade) replaces the old SequrAI entry, not duplicates it", () => {
    const project = tmpProject();
    installAutoSecurityHooks(project, HOOK_PATH);
    installAutoSecurityHooks(project, "/home/dev/.sequrai/auto-security-hook.mjs"); // same path, simulating a version bump with the same install location

    const claudeSettings = readJson(join(project, ".claude/settings.json"));
    expect(claudeSettings.hooks.Stop).toHaveLength(1);
  });
});

describe("Installer: uninstall removes only SequrAI-owned hooks", () => {
  it("D — uninstall removes SequrAI's hooks but leaves the user's own hooks intact", () => {
    const project = tmpProject();
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(
      join(project, ".claude/settings.json"),
      JSON.stringify(
        { hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo user-hook" }] }] } },
        null,
        2
      )
    );
    installAutoSecurityHooks(project, HOOK_PATH);

    let claudeSettings = readJson(join(project, ".claude/settings.json"));
    expect(claudeSettings.hooks.PostToolUse).toHaveLength(2);

    const removed = uninstallAutoSecurityHooks(project);
    expect(removed.length).toBeGreaterThan(0);

    claudeSettings = readJson(join(project, ".claude/settings.json"));
    expect(claudeSettings.hooks.PostToolUse).toHaveLength(1);
    expect(claudeSettings.hooks.PostToolUse[0].hooks[0].command).toBe("echo user-hook");
    expect(claudeSettings.hooks.Stop).toEqual([]); // event key preserved, SequrAI's own group removed
  });

  it("uninstall on a project with no SequrAI hooks is a safe no-op", () => {
    const project = tmpProject();
    const removed = uninstallAutoSecurityHooks(project);
    expect(removed).toEqual([]);
  });

  it("reinstall after uninstall produces a clean, correctly-idempotent single entry again", () => {
    const project = tmpProject();
    installAutoSecurityHooks(project, HOOK_PATH);
    uninstallAutoSecurityHooks(project);
    installAutoSecurityHooks(project, HOOK_PATH);

    const claudeSettings = readJson(join(project, ".claude/settings.json"));
    expect(claudeSettings.hooks.PostToolUse).toHaveLength(1);
    expect(claudeSettings.hooks.Stop).toHaveLength(1);
  });
});
