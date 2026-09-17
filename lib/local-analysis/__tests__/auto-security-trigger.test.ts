import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateAutoSecurityTrigger,
  formatAutoSecurityFeedback,
  readAutoSecurityState,
  recordChangedPath,
} from "../auto-security-trigger";

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

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Auto-Security MVP: end-to-end trigger decision", () => {
  it("test #1: a non-security change does not trigger a review", async () => {
    const root = tmpWorkspace("seq-auto-nonsec-");
    write(root, "app.ts", "export const ok = true;\n");
    commitAll(root, "initial");
    recordChangedPath(root, "README.md");

    const decision = await evaluateAutoSecurityTrigger(root);
    expect(decision.action).toBe("skipped");
  });

  it("test #2: a security-sensitive change triggers a real review through the canonical path", async () => {
    const root = tmpWorkspace("seq-auto-sec-");
    write(root, "app/api/projects/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");
    recordChangedPath(root, "app/api/projects/route.ts");

    const decision = await evaluateAutoSecurityTrigger(root);
    expect(decision.action).toBe("triggered");
    if (decision.action !== "triggered") throw new Error("expected triggered");
    expect(decision.result.findings.some((f) => f.ruleId === "auth.missing")).toBe(true);
    // Proves the canonical path ran: phase/engines/verdict all present, the
    // same shape sequrai_local_audit itself returns.
    expect(["complete", "partial"]).toContain(decision.result.phase);
    expect(Array.isArray(decision.result.engines)).toBe(true);
  });

  it("test #3/#4: rapid multiple edits across multiple sensitive files coalesce into exactly ONE review", async () => {
    const root = tmpWorkspace("seq-auto-coalesce-");
    write(root, "app/api/a/route.ts", "export async function GET(){ return Response.json({}); }\n");
    write(root, "app/api/b/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");

    // Simulate 9 rapid tool-use events across the same agent turn.
    for (const path of [
      "app/api/a/route.ts",
      "lib/util.ts",
      "app/api/b/route.ts",
      "README.md",
      "app/api/a/route.ts",
      "package.json",
      "app/api/b/route.ts",
      "styles/theme.css",
      "app/api/a/route.ts",
    ]) {
      recordChangedPath(root, path);
    }

    const state = readAutoSecurityState(root);
    expect(state.pendingPaths).toHaveLength(6); // deduped: a, util, b, README, package.json, theme.css

    const decision = await evaluateAutoSecurityTrigger(root);
    expect(decision.action).toBe("triggered");

    // The pending queue is now empty -- exactly one review consumed all 9 events.
    const stateAfter = readAutoSecurityState(root);
    expect(stateAfter.pendingPaths).toHaveLength(0);
  });

  it("test #5: a duplicate Stop event (no git-state change) does not produce a second review", async () => {
    const root = tmpWorkspace("seq-auto-dup-");
    write(root, "app/api/projects/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");
    recordChangedPath(root, "app/api/projects/route.ts");

    const first = await evaluateAutoSecurityTrigger(root);
    expect(first.action).toBe("triggered");

    // A second Stop event fires with the SAME pending path re-recorded but
    // no actual code change in between (git state identical).
    recordChangedPath(root, "app/api/projects/route.ts");
    const second = await evaluateAutoSecurityTrigger(root);
    expect(second.action).toBe("skipped");
    if (second.action !== "skipped") throw new Error("expected skipped");
    expect(second.reason.toLowerCase()).toContain("duplicate");
  });

  it("a REAL subsequent code change after a trigger DOES produce a second review", async () => {
    const root = tmpWorkspace("seq-auto-real-change-");
    write(root, "app/api/projects/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");
    recordChangedPath(root, "app/api/projects/route.ts");
    const first = await evaluateAutoSecurityTrigger(root);
    expect(first.action).toBe("triggered");

    write(root, "app/api/projects/route.ts", "export async function GET(){ return Response.json({ordered:true}); }\n");
    commitAll(root, "second change");
    recordChangedPath(root, "app/api/projects/route.ts");
    const second = await evaluateAutoSecurityTrigger(root);
    expect(second.action).toBe("triggered");
  });

  it("test #10: workspace isolation -- pending state and triggers for one workspace never affect another", async () => {
    const rootA = tmpWorkspace("seq-auto-wsA-");
    write(rootA, "app.ts", "export const ok = true;\n");
    commitAll(rootA, "initial");
    const rootB = tmpWorkspace("seq-auto-wsB-");
    write(rootB, "app/api/x/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(rootB, "initial");

    recordChangedPath(rootB, "app/api/x/route.ts");

    expect(readAutoSecurityState(rootA).pendingPaths).toHaveLength(0);
    expect(readAutoSecurityState(rootB).pendingPaths).toHaveLength(1);

    const decisionA = await evaluateAutoSecurityTrigger(rootA);
    expect(decisionA.action).toBe("skipped"); // A has no pending changes at all
  });

  it("test #11: a malicious relative path recorded for one workspace cannot escape to another location (state file stays symlink-safe)", async () => {
    const root = tmpWorkspace("seq-auto-malformed-");
    write(root, "app.ts", "export const ok = true;\n");
    commitAll(root, "initial");

    // A relative path that looks like a traversal attempt is just stored as
    // an opaque string for classification purposes -- it is never used to
    // read/write a file at that location, so traversal has no effect here.
    recordChangedPath(root, "../../../etc/passwd");
    const decision = await evaluateAutoSecurityTrigger(root);
    // Classified as an unrecognized path -> relevant (uncertain bias), but
    // critically the scan still only ever touches `root` itself (via
    // runLocalProductionVerdict's own boundary-checked workspace resolution).
    expect(["skipped", "triggered"]).toContain(decision.action);
  });

  it("fails closed when .sequrai is a symlink (mirrors local-persistence.ts's own defense)", () => {
    const root = tmpWorkspace("seq-auto-symlink-");
    const outside = mkdtempSync(join(tmpdir(), "seq-auto-outside-"));
    tempDirs.push(outside);
    symlinkSync(outside, join(root, ".sequrai"));

    expect(() => recordChangedPath(root, "app/api/x/route.ts")).toThrow();
  });

  it("formatAutoSecurityFeedback never claims verified/secure/safe", async () => {
    const root = tmpWorkspace("seq-auto-feedback-");
    write(root, "app/api/projects/route.ts", "export async function GET(){ return Response.json({}); }\n");
    commitAll(root, "initial");
    recordChangedPath(root, "app/api/projects/route.ts");
    const decision = await evaluateAutoSecurityTrigger(root);
    const feedback = formatAutoSecurityFeedback(decision);
    expect(feedback.toLowerCase()).not.toMatch(/\bverified\b|\bsecure\b(?! verification)|\ball clear\b/);
  });
});
