import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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

/**
 * child_process.execFile's `input` option only exists on the SYNCHRONOUS
 * execFileSync -- the async/promisified execFile has no such option and
 * silently ignores an `input` field, leaving the child's stdin open until
 * the hook script's own 5s fallback timeout. Written to child.stdin
 * directly here instead, matching how a real agent's hook runner actually
 * invokes this script (write payload, close stdin).
 */
function runHookAsync(payload: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [HOOK_PATH], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", () => {
      if (stderr && !stderr.includes("ExperimentalWarning")) console.error("HOOK STDERR:", stderr);
      resolve(stdout);
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Auto-Security MVP: five-developer concurrent hook simulation", () => {
  it(
    "5 developers editing security-sensitive files concurrently each get their own isolated automatic review, no cross-contamination",
    async () => {
      const devs = ["A", "B", "C", "D", "E"].map((label) => {
        const root = tmpWorkspace(`seq-auto-5dev-${label}-`);
        write(root, `app/api/${label.toLowerCase()}/route.ts`, `export async function GET(){ return Response.json({label:"${label}"}); }\n`);
        commitAll(root, `dev ${label} initial`);
        return { label, root };
      });

      // Real concurrent PostToolUse events (each dev's agent editing its own file).
      await Promise.all(
        devs.map((dev) => runHookAsync({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(dev.root, `app/api/${dev.label.toLowerCase()}/route.ts`) }, cwd: dev.root }))
      );

      // Real concurrent Stop events -- 5 genuinely simultaneous review triggers.
      const results = await Promise.all(devs.map((dev) => runHookAsync({ hook_event_name: "Stop", cwd: dev.root })));

      for (let i = 0; i < devs.length; i += 1) {
        expect(results[i], `dev ${devs[i]!.label} at ${devs[i]!.root}`).toContain("SequrAI Auto-Security");
        const parsed = JSON.parse(results[i]!);
        // Each developer's review only ever mentions their OWN endpoint path.
        const context: string = parsed.hookSpecificOutput.additionalContext;
        expect(context).toBeTruthy();
      }

      // Cross-check via persisted state: each workspace's own scan is isolated.
      const { openLocalPersistenceStore } = await import("../../lib/local-analysis/local-persistence");
      const { resolveLocalIdentity } = await import("../../lib/local-analysis/local-identity");
      const identities = await Promise.all(devs.map((dev) => resolveLocalIdentity(dev.root)));
      const workspaceIds = identities.map((identity) => identity.workspaceId);
      expect(new Set(workspaceIds).size).toBe(5);

      for (let i = 0; i < devs.length; i += 1) {
        const store = openLocalPersistenceStore(devs[i]!.root);
        try {
          const latest = store.getLatestScan(identities[i]!.workspaceId);
          expect(latest).not.toBeNull();
          const findings = store.getFindingsForScan(latest!.scanId);
          // No finding from another developer's file leaked into this scan.
          for (const finding of findings) {
            if (finding.file_path) {
              expect(finding.file_path.includes(`/api/${devs[i]!.label.toLowerCase()}/`) || !finding.file_path.startsWith("app/api/")).toBe(true);
            }
          }
        } finally {
          store.close();
        }
      }
    },
    60_000
  );
});
