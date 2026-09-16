import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeLocalTool } from "../local-tool-handlers";
import type { LocalProductionVerdictResult } from "../types";
import type { LocalSafeFixResult } from "../local-safe-fix";

/**
 * L1.7/L1.8 real-world scenario: exercises the ACTUAL live MCP path end to
 * end (executeLocalTool -> local-tool-handlers -> run-local-verdict ->
 * scanRepository -> local-persistence -> finding-history), no mocks at any
 * layer. This is the same path public/mcp/local-verdict-bundle.mjs bundles
 * (lib/local-analysis/runtime-entry.ts -> index.ts -> executeLocalTool).
 *
 * NOTE on architecture: run-local-verdict.ts (which this exercises) calls
 * scanRepository() directly, not lib/local-analysis/local-orchestrator.ts's
 * runLocalSecurityOrchestrator() -- that multi-engine coordinator has no
 * caller anywhere in the live MCP surface (documented in the L1.6 report).
 * This test therefore proves the loop through the path that is actually
 * live today (native engine only), not the orphaned multi-engine one.
 */

const tempDirs: string[] = [];
const originalWorkspaceRoot = process.env.SEQURAI_WORKSPACE_ROOT;

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "seq-loop-"));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

function writeRoute(repo: string, relativePath: string, content: string): void {
  const full = join(repo, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function commitAll(repo: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: repo });
}

const UNGUARDED_PROJECTS_ROUTE = `
export async function GET(req) {
  const project = await getProjectFromDb(req.params.id);
  return Response.json(project);
}
`;

const GUARDED_PROJECTS_ROUTE = `
import { getServerSession } from "@/lib/auth";

export async function GET(req) {
  const session = await getServerSession();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const project = await getProjectFromDb(req.params.id);
  return Response.json(project);
}
`;

const UNGUARDED_ADMIN_ROUTE = `
export async function GET(req) {
  const stats = await getAdminStats();
  return Response.json(stats);
}
`;

afterEach(() => {
  if (originalWorkspaceRoot === undefined) delete process.env.SEQURAI_WORKSPACE_ROOT;
  else process.env.SEQURAI_WORKSPACE_ROOT = originalWorkspaceRoot;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("L1.7/L1.8: the real end-to-end security feedback loop", () => {
  it(
    "finding -> explanation/fix -> apply fix -> rescan -> RESOLVED -> new finding -> NEW, through the real MCP tool path",
    async () => {
      const repo = makeTempRepo();
      writeRoute(repo, "app/api/projects/route.ts", UNGUARDED_PROJECTS_ROUTE);
      commitAll(repo, "initial");
      process.env.SEQURAI_WORKSPACE_ROOT = repo;

      // 1. Agent: "what security issues do I have?" -- a genuine scan through
      // the real MCP tool.
      const firstAudit = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
      expect(firstAudit.phase).toBe("complete");
      const authFinding = firstAudit.findings.find((f) => f.ruleId === "auth.missing");
      expect(authFinding).toBeTruthy();
      // WHAT/WHERE/EVIDENCE/RECOMMENDATION are already present on the raw finding.
      expect(authFinding?.filePath).toBe("app/api/projects/route.ts");
      expect(authFinding?.remediation).toBeTruthy();

      // 2. Agent asks for fix guidance without knowing the identifier yet --
      // gets a candidate list to choose from.
      const chooseResult = (await executeLocalTool("sequrai_local_fix", {})) as LocalSafeFixResult;
      expect(chooseResult.status).toBe("choose_finding");
      if (chooseResult.status !== "choose_finding") throw new Error("expected choose_finding");
      const candidate = chooseResult.candidates.find((c) => c.ruleId === "auth.missing");
      expect(candidate).toBeTruthy();

      // 3. Agent requests the fix for that specific finding by its
      // correlation identity -- gets a deterministic, non-executing prompt.
      const fixResult = (await executeLocalTool("sequrai_local_fix", {
        correlationKey: candidate!.correlationKey,
      })) as LocalSafeFixResult;
      expect(fixResult.status).toBe("prompt_ready");
      if (fixResult.status !== "prompt_ready") throw new Error("expected prompt_ready");
      expect(fixResult.fixPrompt).toContain("app/api/projects/route.ts");
      expect(fixResult.fixPrompt.toLowerCase()).toContain("authentication");
      expect(fixResult.note.toLowerCase()).toContain("does not execute");

      // 4. Developer/agent applies the change themselves (SequrAI never does this).
      writeRoute(repo, "app/api/projects/route.ts", GUARDED_PROJECTS_ROUTE);
      commitAll(repo, "add auth guard");

      // 5/6/7. Rescan through the real MCP path again -- a genuinely new scan.
      const secondAudit = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
      expect(secondAudit.phase).toBe("complete");
      expect(secondAudit.findings.some((f) => f.ruleId === "auth.missing")).toBe(false);

      // sequrai_local_status is read-only (never triggers its own scan) --
      // the right tool to check history without a redundant rescan
      // (sequrai_local_findings, by contrast, always runs a fresh scan of
      // its own -- calling it here would compare against a THIRD scan it
      // just took, not the fix we're verifying).
      const statusAfterFix = (await executeLocalTool("sequrai_local_status", {})) as {
        history: { resolvedCount: number; newCount: number; resolvedFindings: Array<{ ruleId: string }>; note: string } | null;
      };
      expect(statusAfterFix.history).not.toBeNull();
      expect(statusAfterFix.history!.resolvedFindings.some((f) => f.ruleId === "auth.missing")).toBe(true);
      expect(statusAfterFix.history!.resolvedCount).toBeGreaterThanOrEqual(1);

      // History never claims verification -- only "not detected" (the note
      // explicitly disclaims "proven fixed or secure", it never asserts it).
      expect(statusAfterFix.history?.note.toLowerCase()).not.toContain("verified");
      expect(statusAfterFix.history?.note.toLowerCase()).toContain("not proven fixed or secure");

      // 8. Introduce a genuinely new finding and rescan -- history must show NEW.
      writeRoute(repo, "app/api/admin/route.ts", UNGUARDED_ADMIN_ROUTE);
      commitAll(repo, "add admin route");

      const thirdAudit = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
      expect(thirdAudit.phase).toBe("complete");
      expect(thirdAudit.findings.some((f) => f.filePath === "app/api/admin/route.ts" && f.ruleId === "auth.missing")).toBe(
        true
      );

      const statusAfterNew = (await executeLocalTool("sequrai_local_status", {})) as {
        history: { newCount: number; resolvedCount: number; persistingCount: number } | null;
      };
      expect(statusAfterNew.history?.newCount).toBeGreaterThanOrEqual(1);
    },
    30_000
  );

  it("sequrai_local_fix cannot be used to target another workspace's findings", async () => {
    const repoA = makeTempRepo();
    writeRoute(repoA, "app/api/projects/route.ts", UNGUARDED_PROJECTS_ROUTE);
    commitAll(repoA, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = repoA;
    await executeLocalTool("sequrai_local_audit", {});
    const fixA = (await executeLocalTool("sequrai_local_fix", {})) as LocalSafeFixResult;
    if (fixA.status !== "choose_finding") throw new Error("expected choose_finding");
    const correlationKeyFromA = fixA.candidates[0]!.correlationKey;

    const repoB = makeTempRepo();
    writeRoute(repoB, "app/api/other/route.ts", "export async function GET(){ return Response.json({}); }");
    commitAll(repoB, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = repoB;
    await executeLocalTool("sequrai_local_audit", {});

    await expect(executeLocalTool("sequrai_local_fix", { correlationKey: correlationKeyFromA })).rejects.toThrow();
  }, 30_000);
});
