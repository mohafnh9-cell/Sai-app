import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeLocalTool } from "../local-tool-handlers";
import type { LocalProductionVerdictResult } from "../types";

/**
 * Full System Adversarial Validation V1, Scenario 1: a real .env file
 * containing a real secret is deliberately never read off disk
 * (CREDENTIAL_BASENAME_PATTERNS, workspace.ts) -- correct, intentional
 * privacy behavior, and already honestly counted in
 * snapshot.credentialsSkipped. The gap found: that count never appeared
 * in the narrative text an agent/developer actually reads, so a genuinely
 * unscanned real secret could sit next to an otherwise-clean verdict with
 * no visible warning. Fixed: buildLocalStatusSummary now surfaces it.
 */
const tempDirs: string[] = [];
const originalWorkspaceRoot = process.env.SEQURAI_WORKSPACE_ROOT;

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "seq-cred-skip-"));
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
  if (originalWorkspaceRoot === undefined) delete process.env.SEQURAI_WORKSPACE_ROOT;
  else process.env.SEQURAI_WORKSPACE_ROOT = originalWorkspaceRoot;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("credentialsSkipped narrative honesty", () => {
  it("a real .env file is never read (secrets.exposed cannot see it), and the narrative now discloses this explicitly", async () => {
    const repo = makeTempRepo();
    write(repo, ".env", "STRIPE_SECRET_KEY=sk_live_abcdefghijklmnopqrstuvwxyz\n");
    write(repo, "README.md", "# clean project\n");
    commitAll(repo, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = repo;

    const audit = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;

    // The .env file's real secret is not detected -- this IS the intended
    // privacy behavior, not the bug. Confirm it, don't fight it.
    expect(audit.findings.some((f) => f.ruleId === "secrets.exposed")).toBe(false);

    // What was missing: the fact that it was skipped must be honestly
    // visible where an agent/developer actually reads it.
    expect((audit.snapshot as { credentialsSkipped: number }).credentialsSkipped).toBeGreaterThanOrEqual(1);
    expect((audit as unknown as { narrative: string }).narrative).toContain("NOT SCANNED");
    expect((audit as unknown as { narrative: string }).narrative.toLowerCase()).toContain("credential-shaped file");
  });

  it("does not add a NOT SCANNED section when no credential files were skipped", async () => {
    const repo = makeTempRepo();
    write(repo, "README.md", "# clean project\n");
    commitAll(repo, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = repo;

    const audit = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
    expect((audit.snapshot as { credentialsSkipped: number }).credentialsSkipped).toBe(0);
    expect((audit as unknown as { narrative: string }).narrative).not.toContain("NOT SCANNED");
  });

  it(".env.example (a template with no real secrets, by convention) is still scanned normally", async () => {
    const repo = makeTempRepo();
    write(repo, ".env.example", "STRIPE_SECRET_KEY=your-key-here\n");
    commitAll(repo, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = repo;

    const audit = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
    expect((audit.snapshot as { credentialsSkipped: number }).credentialsSkipped).toBe(0);
  });
});
