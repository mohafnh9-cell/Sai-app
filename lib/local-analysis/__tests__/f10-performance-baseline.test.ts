import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLocalSecurityOrchestrator } from "../local-orchestrator";

/**
 * F10 Phase 10: real timing baseline against a moderately-sized, realistic
 * repository (not a synthetic microbenchmark) through the actual
 * runLocalSecurityOrchestrator() path. Not a pass/fail perf gate -- this
 * phase's own instruction is "measure first, do not optimize without
 * evidence." Numbers are printed for the F10 report rather than asserted
 * against a threshold (no baseline existed before F9 to compare against,
 * since this path had no production caller).
 */

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

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("F10: local scan performance baseline", () => {
  it("measures discovery/native/persistence timing on a ~120-file realistic repo", async () => {
    const root = tmpWorkspace("seq-f10-perf-");

    for (let i = 0; i < 30; i += 1) {
      write(
        root,
        `app/api/resource-${i}/route.ts`,
        `import { getServerSession } from "@/lib/auth";
export async function GET(req) {
  const session = await getServerSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  return Response.json(await getResource${i}(req.params.id, session.user.id));
}
`
      );
      write(
        root,
        `lib/services/service-${i}.ts`,
        `export function compute${i}(a: number, b: number) { return a + b + ${i}; }\n`
      );
      write(root, `components/Widget${i}.tsx`, `export function Widget${i}() { return null; }\n`);
      write(root, `lib/services/__tests__/service-${i}.test.ts`, `test("noop ${i}", () => {});\n`);
    }
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "realistic repo"], { cwd: root });

    const startedAt = Date.now();
    const result = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", persist: true });
    const totalMs = Date.now() - startedAt;

    const nativeOutcome = result.engines.find((e) => e.engine === "native");
    const externalOutcomes = result.engines.filter((e) => e.engine !== "native");

    const summary = {
      F10_PERFORMANCE_BASELINE: true,
      filesWritten: 120,
      filesScanned: result.snapshot.scannedFiles,
      discoveredFiles: result.snapshot.discoveredFiles,
      totalDurationMs: totalMs,
      orchestratorReportedDurationMs: result.durationMs,
      nativeDurationMs: nativeOutcome?.durationMs,
      externalEngines: externalOutcomes.map((e) => ({ engine: e.engine, status: e.status, durationMs: e.durationMs })),
      phase: result.phase,
    };
    console.log(JSON.stringify(summary, null, 2));

    expect(result.snapshot.scannedFiles).toBeGreaterThan(0);
    expect(["complete", "partial"]).toContain(result.phase);
  }, 30_000);
});
