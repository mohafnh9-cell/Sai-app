import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Permanent regression coverage for the DISTRIBUTED artifacts, per the
 * Auto-Security pilot hardening audit's core lesson: source-code tests are
 * not enough. Two real bugs (a Next.js-only "server-only" import guard, and
 * a CommonJS `__dirname` reference in ESM output) had silently crashed
 * public/mcp/local-verdict-bundle.mjs on load -- for every local MCP tool
 * call, not just Auto-Security -- and no test had ever caught this because
 * every prior local-analysis test imported the TypeScript source directly,
 * never the built artifact. These tests exercise the real, built files
 * (never re-running esbuild themselves -- they check what's already
 * committed to public/mcp/, the same bytes a real install would download).
 */

const PUBLIC_MCP_DIR = join(process.cwd(), "public/mcp");
const tempDirs: string[] = [];

function tmpWorkspace(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "app.ts"), "export const ok = true;\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Distributed artifacts: manifest integrity", () => {
  it("bridge.sha256, localAnalysis.bundleSha256, and autoSecurityHook.sha256 all match the real committed files", () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC_MCP_DIR, "install-manifest.json"), "utf8"));

    const bridgeSha256 = createHash("sha256").update(readFileSync(join(PUBLIC_MCP_DIR, "stdio-bridge.mjs"))).digest("hex");
    expect(manifest.bridge.sha256).toBe(bridgeSha256);

    const bundleSha256 = createHash("sha256").update(readFileSync(join(PUBLIC_MCP_DIR, "local-verdict-bundle.mjs"))).digest("hex");
    expect(manifest.localAnalysis.bundleSha256).toBe(bundleSha256);

    const localAnalysisSha256 = createHash("sha256").update(readFileSync(join(PUBLIC_MCP_DIR, "local-analysis.mjs"))).digest("hex");
    expect(manifest.localAnalysis.sha256).toBe(localAnalysisSha256);

    const hookSha256 = createHash("sha256").update(readFileSync(join(PUBLIC_MCP_DIR, "auto-security-hook.mjs"))).digest("hex");
    expect(manifest.autoSecurityHook.sha256).toBe(hookSha256);
  });

  it("mcp/stdio-bridge.mjs (source) and public/mcp/stdio-bridge.mjs (distributed copy) are byte-identical", () => {
    const source = readFileSync(join(process.cwd(), "mcp/stdio-bridge.mjs"), "utf8");
    const distributed = readFileSync(join(PUBLIC_MCP_DIR, "stdio-bridge.mjs"), "utf8");
    expect(distributed).toBe(source);
  });

  it("mcp/auto-security-hook.mjs (source) and public/mcp/auto-security-hook.mjs (distributed copy) are byte-identical", () => {
    const source = readFileSync(join(process.cwd(), "mcp/auto-security-hook.mjs"), "utf8");
    const distributed = readFileSync(join(PUBLIC_MCP_DIR, "auto-security-hook.mjs"), "utf8");
    expect(distributed).toBe(source);
  });
});

describe("Distributed artifacts: bundle never regresses to a load-time crash", () => {
  it("the built bundle contains no unconditional server-only throw", () => {
    const bundle = readFileSync(join(PUBLIC_MCP_DIR, "local-verdict-bundle.mjs"), "utf8");
    expect(bundle).not.toContain("This module cannot be imported from a Client Component module");
  });

  it("the built bundle defines __dirname/__filename for ESM (no bare CommonJS global reference survives unshimmed)", () => {
    const bundle = readFileSync(join(PUBLIC_MCP_DIR, "local-verdict-bundle.mjs"), "utf8");
    // The esbuild banner (scripts/bundle-local-mcp.mjs) must define these
    // before any bundled module code that references them.
    expect(bundle).toContain("const __dirname");
    expect(bundle).toContain("const __filename");
  });

  it("the real bundle loads and runs successfully as a plain Node subprocess (not just imported in a test runner)", () => {
    const root = tmpWorkspace("seq-dist-bundle-load-");
    const output = execFileSync(
      "node",
      ["-e", `import("${join(PUBLIC_MCP_DIR, "local-analysis.mjs")}").then(m => m.executeLocalTool("sequrai_local_status", {})).then(r => console.log(JSON.stringify(r.source))).catch(e => { console.error(e); process.exit(1); })`],
      { encoding: "utf8", env: { ...process.env, SEQURAI_WORKSPACE_ROOT: root } }
    );
    expect(output.trim()).toContain('"local"');
  });
});

describe("Distributed artifacts: stdio-bridge.mjs real subprocess smoke test", () => {
  it("responds correctly to a real tools/call JSON-RPC request for a local tool", () => {
    const root = tmpWorkspace("seq-dist-stdio-bridge-");
    const output = execFileSync("node", [join(PUBLIC_MCP_DIR, "stdio-bridge.mjs")], {
      input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "sequrai_local_status", arguments: {} } })}\n`,
      env: { ...process.env, SEQURAI_WORKSPACE_ROOT: root, SEQURAI_API_KEY: "dummy-for-local-tool-test" },
      encoding: "utf8",
      timeout: 15_000,
    });
    const lines = output.trim().split("\n").filter(Boolean);
    const response = JSON.parse(lines[lines.length - 1]!);
    expect(response.id).toBe(1);
    expect(response.result).toBeTruthy();
    const parsed = JSON.parse(response.result.content[0].text);
    expect(parsed.source).toBe("local");
    expect(parsed.isGitRepository).toBe(true);
  });
});
