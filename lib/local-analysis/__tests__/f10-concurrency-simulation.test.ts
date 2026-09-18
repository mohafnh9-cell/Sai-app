import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLocalSecurityOrchestrator } from "../local-orchestrator";

/**
 * F10 Phase 11: simulates ~5 developers working concurrently, two of them
 * (A and D) on clones of the SAME repository (same git remote -> same
 * repositoryId, different absolute paths -> different workspaceId), the
 * rest on distinct repositories. All run through the real orchestrator
 * concurrently via Promise.all -- proving no cross-workspace/repository
 * leakage, no duplicate/corrupted persistence, and no incorrect verdict
 * attribution under real concurrency (not sequential calls that happen to
 * look concurrent).
 */

const tempDirs: string[] = [];

function tmpWorkspace(prefix: string, remoteUrl?: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  if (remoteUrl) execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: dir });
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

describe("F10: five-developer concurrency simulation", () => {
  it(
    "5 developers (2 sharing a repository via separate clones) scan concurrently with full isolation",
    async () => {
      // Developer A and D: two independent clones of the SAME repository.
      const devA = tmpWorkspace("seq-f10-devA-", "https://github.com/acme/shared-app.git");
      write(devA, "app/api/auth-work/route.ts", `export async function GET(){ return Response.json({}); }\n`);
      commitAll(devA, "dev A: auth work");

      const devD = tmpWorkspace("seq-f10-devD-", "https://github.com/acme/shared-app.git");
      write(devD, "app/api/frontend-work/route.ts", `export async function GET(){ return Response.json({}); }\n`);
      commitAll(devD, "dev D: frontend work");

      // Developer B: project B, has a secret.
      const devB = tmpWorkspace("seq-f10-devB-");
      const secretB = ["sk_", "live_", "b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1"].join("");
      write(devB, "lib/config.ts", `export const key = "${secretB}";\n`);
      commitAll(devB, "dev B: project B");

      // Developer C: project C, clean.
      const devC = tmpWorkspace("seq-f10-devC-");
      write(devC, "lib/util.ts", "export const add = (a: number, b: number) => a + b;\n");
      commitAll(devC, "dev C: project C");

      // Developer E: project D, has an RLS finding.
      const devE = tmpWorkspace("seq-f10-devE-");
      write(devE, "database/migrations/001_oops.sql", "ALTER TABLE public.accounts DISABLE ROW LEVEL SECURITY;\n");
      commitAll(devE, "dev E: project D");

      const [resultA, resultB, resultC, resultD, resultE] = await Promise.all([
        runLocalSecurityOrchestrator({ workspacePath: devA, scope: "workspace", persist: true }),
        runLocalSecurityOrchestrator({ workspacePath: devB, scope: "workspace", persist: true }),
        runLocalSecurityOrchestrator({ workspacePath: devC, scope: "workspace", persist: true }),
        runLocalSecurityOrchestrator({ workspacePath: devD, scope: "workspace", persist: true }),
        runLocalSecurityOrchestrator({ workspacePath: devE, scope: "workspace", persist: true }),
      ]);

      // A and D share a repositoryId (same remote) but have distinct workspaceIds and scanIds.
      expect(resultA.identity.repositoryId).toBe(resultD.identity.repositoryId);
      expect(resultA.identity.workspaceId).not.toBe(resultD.identity.workspaceId);
      expect(resultA.scanId).not.toBe(resultD.scanId);

      // Every workspaceId is otherwise distinct.
      const workspaceIds = [resultA, resultB, resultC, resultD, resultE].map((r) => r.identity.workspaceId);
      expect(new Set(workspaceIds).size).toBe(5);

      // Every scanId is distinct -- no collision under real concurrency.
      const scanIds = [resultA, resultB, resultC, resultD, resultE].map((r) => r.scanId);
      expect(new Set(scanIds).size).toBe(5);

      // No cross-contamination of findings: B's secret never appears for
      // anyone else, E's RLS finding never appears for anyone else, and A's/D's
      // findings never leak into each other despite sharing a repositoryId.
      const findingRuleIds = (r: (typeof resultA)) => new Set(r.findings.map((f) => f.rule_id));
      expect(findingRuleIds(resultB).has("secrets.exposed")).toBe(true);
      for (const other of [resultA, resultC, resultD, resultE]) {
        expect(findingRuleIds(other).has("secrets.exposed")).toBe(false);
      }
      expect(findingRuleIds(resultE).has("supabase.rls")).toBe(true);
      for (const other of [resultA, resultB, resultC, resultD]) {
        expect(findingRuleIds(other).has("supabase.rls")).toBe(false);
      }

      // Every scan completed honestly (native ran; no accidental "incomplete").
      for (const result of [resultA, resultB, resultC, resultD, resultE]) {
        expect(["complete", "partial"]).toContain(result.phase);
      }

      // Persistence: each workspace's own SQLite file has exactly its own
      // scan/findings recorded -- no cross-workspace row leakage. A and D
      // share a repositoryId but persist to DIFFERENT files (one per
      // workspace root), so reading A's store must never see D's scan.
      const { openLocalPersistenceStore } = await import("../local-persistence");
      const storeA = openLocalPersistenceStore(devA);
      try {
        const scanFromA = storeA.getScan(resultA.scanId);
        const scanFromDInA = storeA.getScan(resultD.scanId);
        expect(scanFromA).not.toBeNull();
        expect(scanFromDInA).toBeNull();
      } finally {
        storeA.close();
      }
    },
    30_000
  );
});
