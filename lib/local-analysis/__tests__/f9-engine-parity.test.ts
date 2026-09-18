import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * F9: proves the actually-live MCP local scan path (executeLocalTool ->
 * local-tool-handlers -> run-local-verdict -> runLocalSecurityOrchestrator)
 * now genuinely routes through the existing multi-engine orchestrator,
 * instead of run-local-verdict.ts calling scanRepository() directly the
 * way it always had before this phase. Before F9, local-orchestrator.ts's
 * runLocalSecurityOrchestrator() had no production caller at all -- OpenGrep
 * /Trivy/crypto/Scorecard existed in the codebase but never ran for a real
 * developer using sequrai_local_audit.
 */

const tempDirs: string[] = [];
const originalWorkspaceRoot = process.env.SEQURAI_WORKSPACE_ROOT;

function tmpWorkspace(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

function commitAll(repo: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: repo });
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/features/security-scanner/scanner");
  if (originalWorkspaceRoot === undefined) delete process.env.SEQURAI_WORKSPACE_ROOT;
  else process.env.SEQURAI_WORKSPACE_ROOT = originalWorkspaceRoot;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("F9: the real MCP audit path routes through the local orchestrator", () => {
  it("test #1: sequrai_local_audit invokes the orchestrator, not a bespoke direct scan", async () => {
    const root = tmpWorkspace("seq-f9-invoke-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n");
    commitAll(root, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    // Asserted behaviorally: the orchestrator's own distinguishing output
    // field (a real per-engine `engines` breakdown covering native AND the
    // external-and-native-adjacent registry) only exists on
    // runLocalSecurityOrchestrator()'s result -- run-local-verdict.ts's old
    // direct scanRepository() path never produced one.
    const { executeLocalTool } = await import("../local-tool-handlers");
    const result = (await executeLocalTool("sequrai_local_audit", {})) as {
      engines: Array<{ engine: string; status: string }>;
      scanMetrics: { scannedFiles: number };
    };

    expect(Array.isArray(result.engines)).toBe(true);
    expect(result.engines.some((e) => e.engine === "native")).toBe(true);
    // The external-and-native-adjacent engines are represented too (SKIPPED
    // is a legitimate, honest outcome when a binary isn't configured in this
    // test environment -- what matters is that they were genuinely considered
    // by runSecurityEngines(), not silently absent from the response).
    const engineNames = new Set(result.engines.map((e) => e.engine));
    for (const expected of ["opengrep", "trivy", "crypto"]) {
      expect(engineNames.has(expected), `expected engine "${expected}" to appear in the response`).toBe(true);
    }
  });

  it("test #13: scanRepository (the native engine) executes exactly once per sequrai_local_audit call, never twice", async () => {
    const root = tmpWorkspace("seq-f9-no-double-exec-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n");
    commitAll(root, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    const actual = await vi.importActual<typeof import("@/features/security-scanner/scanner")>(
      "@/features/security-scanner/scanner"
    );
    const scanSpy = vi.fn(actual.scanRepository);
    vi.doMock("@/features/security-scanner/scanner", () => ({
      ...actual,
      scanRepository: scanSpy,
    }));

    const { executeLocalTool } = await import("../local-tool-handlers");
    await executeLocalTool("sequrai_local_audit", {});

    expect(scanSpy).toHaveBeenCalledTimes(1);
  });

  it("test #2: native findings survive the full path with a stable correlationKey and real evidence", async () => {
    const root = tmpWorkspace("seq-f9-native-findings-");
    mkdirSync(join(root, "app/api/projects"), { recursive: true });
    writeFileSync(
      join(root, "app/api/projects/route.ts"),
      "export async function GET(req) { return Response.json(await getProjectFromDb(req.params.id)); }\n"
    );
    commitAll(root, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    const { executeLocalTool } = await import("../local-tool-handlers");
    const result = (await executeLocalTool("sequrai_local_audit", {})) as {
      findings: Array<{ ruleId: string; correlationKey: string; filePath: string | null }>;
    };

    const finding = result.findings.find((f) => f.ruleId === "auth.missing");
    expect(finding).toBeTruthy();
    expect(finding?.correlationKey).toBeTruthy();
    expect(finding?.filePath).toBe("app/api/projects/route.ts");
  });

  it("test #7: an engine failure is reported as partial, never silently folded into a clean/complete result", async () => {
    vi.resetModules();
    vi.doMock("@/server/security-engines/orchestrate", () => ({
      runSecurityEngines: vi.fn().mockResolvedValue({
        results: [
          {
            engine: "opengrep",
            status: "FAILED",
            durationMs: 5,
            findings: [],
            errors: [{ code: "engine_crashed", message: "real crash" }],
          },
        ],
      }),
    }));

    const root = tmpWorkspace("seq-f9-engine-failure-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n");
    commitAll(root, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    const { executeLocalTool } = await import("../local-tool-handlers");
    const result = (await executeLocalTool("sequrai_local_audit", {})) as {
      phase: string;
      engines: Array<{ engine: string; status: string }>;
    };

    expect(result.phase).toBe("partial");
    expect(result.engines.find((e) => e.engine === "opengrep")?.status).toBe("FAILED");
  });

  it("test #8/incomplete: a native engine crash is never presented as a completed, trustworthy analysis", async () => {
    vi.resetModules();
    vi.doMock("@/features/security-scanner/scanner", () => ({
      scanRepository: vi.fn().mockRejectedValue(new Error("native crashed")),
    }));

    const root = tmpWorkspace("seq-f9-native-crash-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n");
    commitAll(root, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    const { executeLocalTool } = await import("../local-tool-handlers");
    const result = (await executeLocalTool("sequrai_local_audit", {})) as {
      phase: string;
      verdictStatus: string;
      score: number | null;
    };

    expect(result.phase).toBe("incomplete");
    // The MCP contract still requires a verdictStatus/score (STEP: do not
    // casually change the public response shape) -- but it must never claim
    // readiness for an analysis that never actually ran.
    expect(result.verdictStatus).not.toBe("ready_to_ship");
  });

  it("test #12: two concurrent audits of two different workspaces stay isolated (no cross-workspace findings/identity)", async () => {
    const rootA = tmpWorkspace("seq-f9-concurrent-a-");
    mkdirSync(join(rootA, "app/api/projects"), { recursive: true });
    writeFileSync(join(rootA, "app/api/projects/route.ts"), "export async function GET(){ return Response.json({}); }\n");
    commitAll(rootA, "initial");

    const rootB = tmpWorkspace("seq-f9-concurrent-b-");
    writeFileSync(join(rootB, "clean.ts"), "export const ok = true;\n");
    commitAll(rootB, "initial");

    const { runLocalSecurityOrchestrator } = await import("../local-orchestrator");
    const [resultA, resultB] = await Promise.all([
      runLocalSecurityOrchestrator({ workspacePath: rootA, scope: "workspace" }),
      runLocalSecurityOrchestrator({ workspacePath: rootB, scope: "workspace" }),
    ]);

    expect(resultA.identity.workspaceId).not.toBe(resultB.identity.workspaceId);
    expect(resultA.findings.some((f) => f.rule_id === "auth.missing")).toBe(true);
    expect(resultB.findings.some((f) => f.rule_id === "auth.missing")).toBe(false);
  });
});
