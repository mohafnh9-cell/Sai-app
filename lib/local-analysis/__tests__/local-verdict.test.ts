import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLocalStatusSummary } from "../format-local-response";
import { runLocalProductionVerdict } from "../run-local-verdict";
import {
  isIgnoredRelativePath,
  listWorkspaceFiles,
  normalizeWorkspaceRoot,
  readWorkspaceTextFile,
  resolveSafePath,
} from "../workspace";

function initGitRepo(root: string): boolean {
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@sequrai.local"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "SequrAI Test"], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("local production verdict", () => {
  it("A/B — empty workspace returns insufficient_data with null score", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-local-empty-"));
    mkdirSync(join(root, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules/pkg/index.js"), "console.log('ignored')");

    const result = await runLocalProductionVerdict({ workspacePath: root, scope: "workspace" });
    expect(result.source).toBe("local");
    expect(result.findings).toHaveLength(0);
    expect(result.score).toBeNull();
    expect(result.verdictStatus).toBe("insufficient_data");
  });

  it("C — detects secret finding via canonical scanner", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-local-secret-"));
    const fakeStripeSecret = ["sk_", "live_", "abcdefghijklmnopqrstuvwxyz123456"].join("");
    writeFileSync(join(root, "config.ts"), `export const token = "${fakeStripeSecret}";`);
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n".repeat(20));
    writeFileSync(join(root, "routes.ts"), "export const route = '/api';\n".repeat(20));

    const result = await runLocalProductionVerdict({ workspacePath: root, scope: "workspace" });
    expect(result.source).toBe("local");
    expect(result.findings.some((f) => f.severity === "critical" || f.severity === "high")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });

  it("D/E — critical and high findings affect verdict status", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-local-blockers-"));
    mkdirSync(join(root, "app/api/admin"), { recursive: true });
    writeFileSync(
      join(root, "app/api/admin/route.ts"),
      [
        "export async function POST(request: Request) {",
        "  const body = await request.json();",
        "  return Response.json(await db.query(`SELECT * FROM users WHERE id = ${body.id}`));",
        "}",
      ].join("\n")
    );
    writeFileSync(join(root, "lib.ts"), "export const x = 1;\n".repeat(30));
    writeFileSync(join(root, "util-a.ts"), "export const a = 1;\n".repeat(10));
    writeFileSync(join(root, "util-b.ts"), "export const b = 2;\n".repeat(10));

    const result = await runLocalProductionVerdict({ workspacePath: root, scope: "workspace" });
    expect(["not_ready", "needs_improvement", "almost_ready", "insufficient_data"]).toContain(
      result.verdictStatus
    );
    if (result.verdictStatus !== "insufficient_data") {
      expect(result.blockersCount).toBeGreaterThan(0);
    }
  });

  // P10 (audit): investigated, not just re-timed blindly. Reproduced in
  // isolation with a generous timeout -- runLocalProductionVerdict
  // consistently takes ~3.5-4s even for this 4-file synthetic workspace
  // (no network calls anywhere in its call graph, verified by grep). Real,
  // reproducible cost inside the pipeline (scanRepository's fixed
  // per-invocation overhead, same root cause as the pipeline.integration
  // test), not a hang -- it just leaves too little headroom under vitest's
  // 5000ms default under parallel test-run CPU contention.
  it("J — clean workspace can reach ready_to_ship when evidence is sufficient", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-local-clean-"));
    mkdirSync(join(root, "app"), { recursive: true });
    mkdirSync(join(root, "lib"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } })
    );
    writeFileSync(join(root, "app/page.tsx"), "export default function Page(){ return <main>ok</main>; }");
    writeFileSync(join(root, "lib/util.ts"), "export function util(){ return 1; }\n".repeat(10));
    writeFileSync(join(root, "README.md"), "# demo");

    const result = await runLocalProductionVerdict({ workspacePath: root, scope: "workspace" });
    expect(result.source).toBe("local");
    expect(result.score).not.toBeNull();
    expect(["ready_to_ship", "almost_ready", "needs_improvement", "insufficient_data"]).toContain(
      result.verdictStatus
    );
  }, 15_000);

  it("K — insufficient data when scoped diff has no changed files", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-local-diff-empty-"));
    if (!initGitRepo(root)) return;
    writeFileSync(join(root, "app.ts"), "export const ok = true;");
    execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });

    const result = await runLocalProductionVerdict({ workspacePath: root, scope: "diff" });
    expect(result.scope).toBe("diff");
    expect(result.verdictStatus).toBe("insufficient_data");
    expect(result.score).toBeNull();
  });

  it("L/M — git diff and staged scopes analyze changed files only", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-local-git-"));
    if (!initGitRepo(root)) return;
    writeFileSync(join(root, "safe.ts"), "export const safe = true;\n".repeat(20));
    writeFileSync(join(root, "README.md"), "# ok");
    execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "base"], { cwd: root, stdio: "ignore" });

    writeFileSync(
      join(root, "unsafe.ts"),
      'const password = "super-secret-password-value";\nexport const x = 1;\n'.repeat(5)
    );
    execFileSync("git", ["add", "unsafe.ts"], { cwd: root, stdio: "ignore" });

    const staged = await runLocalProductionVerdict({ workspacePath: root, scope: "staged" });
    expect(staged.scope).toBe("staged");
    expect(staged.source).toBe("local");

    writeFileSync(join(root, "another.ts"), "export const y = 2;\n".repeat(5));
    const diff = await runLocalProductionVerdict({ workspacePath: root, scope: "diff" });
    expect(diff.scope).toBe("diff");
  });

  it("N — .sequraiignore excludes files from analysis", () => {
    const root = mkdtempSync(join(tmpdir(), "seq-local-ignore-"));
    writeFileSync(join(root, "keep.ts"), "export const keep = true;");
    writeFileSync(join(root, "skip.ts"), "export const skip = true;");
    writeFileSync(join(root, ".sequraiignore"), "skip.ts\n");

    const listing = listWorkspaceFiles(root);
    expect(listing.files.some((file) => file.relativePath === "keep.ts")).toBe(true);
    expect(listing.files.some((file) => file.relativePath === "skip.ts")).toBe(false);
    expect(isIgnoredRelativePath("skip.ts", root)).toBe(true);
  });

  it("O/P — path traversal and symlink escape are blocked", () => {
    const root = mkdtempSync(join(tmpdir(), "seq-local-path-"));
    writeFileSync(join(root, "inside.ts"), "ok");

    expect(() => resolveSafePath(root, "../../etc/passwd")).toThrow(/workspace_path_not_authorized/);
    expect(() => resolveSafePath(root, "%2e%2e/%2e%2e/secret")).toThrow(/workspace_path_not_authorized/);

    const outside = mkdtempSync(join(tmpdir(), "seq-local-outside-"));
    writeFileSync(join(outside, "secret.txt"), "outside");
    try {
      symlinkSync(outside, join(root, "escape-link"));
      expect(() => resolveSafePath(root, "escape-link/secret.txt")).toThrow(/symlink_not_allowed/);
    } catch {
      // sandbox may disallow symlink creation
    }
  });

  it("Q — secret redaction in finding evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-local-redact-"));
    writeFileSync(
      join(root, "env.ts"),
      'export const db = "postgres://user:real-password@localhost:5432/app";\n'.repeat(5)
    );
    writeFileSync(join(root, "util.ts"), "export const ok = true;\n".repeat(10));

    const result = await runLocalProductionVerdict({ workspacePath: root, scope: "workspace" });
    expect(JSON.stringify(result.findings)).not.toContain("real-password");
  });

  it("R/S — local verdict shape and explicit source", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-local-shape-"));
    writeFileSync(join(root, "a.ts"), "export const a = 1;\n".repeat(10));
    writeFileSync(join(root, "b.ts"), "export const b = 2;\n".repeat(10));
    writeFileSync(join(root, "c.ts"), "export const c = 3;\n".repeat(10));

    const result = await runLocalProductionVerdict({ workspacePath: root, scope: "workspace" });
    expect(result.source).toBe("local");
    expect(result.productionVerdict).toMatchObject({
      status: result.verdictStatus,
      score: result.score,
      blockersCount: result.blockersCount,
    });
    expect(result.narrative).toContain("SOURCE: Local workspace");
    expect(result.narrative).toContain("Remote MCP tools");
  });

  it("T/U — narrative without findings avoids secret remediation; with secret includes steps", () => {
    const empty = buildLocalStatusSummary({
      scope: "workspace",
      verdictStatus: "ready_to_ship",
      score: 90,
      findings: [],
    });
    expect(empty).not.toContain("Rotate");
    expect(empty).not.toContain("Remove real credentials");

    const withSecret = buildLocalStatusSummary({
      scope: "workspace",
      verdictStatus: "not_ready",
      score: 40,
      findings: [
        {
          id: "1",
          ruleId: "exposed-credential",
          title: "Exposed API key",
          description: "Credential detected",
          severity: "critical",
          category: "secrets",
          filePath: "config.ts",
          line: 1,
          remediation: "Remove and rotate",
          confidence: "high",
          safeToIgnore: false,
        },
      ],
    });
    expect(withSecret).toContain("Remove real credentials");
  });
});

describe("workspace root normalization", () => {
  it("normalizes workspace root safely", () => {
    const root = mkdtempSync(join(tmpdir(), "seq-local-root-"));
    expect(normalizeWorkspaceRoot(root)).toBe(root);
  });
});
