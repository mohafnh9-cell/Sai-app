import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeLocalTool, isLocalAuditToolName, isLocalToolName } from "../local-tool-handlers";
import { runLocalProductionVerdict } from "../run-local-verdict";
import {
  LOCAL_SCAN_LIMITS,
  isCredentialDeniedBasename,
  isIgnoredRelativePath,
  listWorkspaceFiles,
  readWorkspaceTextFile,
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

describe("D.11 local tool surface", () => {
  it("registers audit_local_project alias", () => {
    expect(isLocalToolName("audit_local_project")).toBe(true);
    expect(isLocalAuditToolName("audit_local_project")).toBe(true);
    expect(isLocalAuditToolName("sequrai_local_audit")).toBe(true);
  });

  it("alias returns the same verdict shape as sequrai_local_audit", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-d11-alias-"));
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n".repeat(15));
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    const primary = await executeLocalTool("sequrai_local_audit", { workspacePath: root });
    const alias = await executeLocalTool("audit_local_project", { workspacePath: root });

    expect(primary.source).toBe("local");
    expect(alias.source).toBe("local");
    expect(alias.verdictStatus).toBe(primary.verdictStatus);
    expect(alias.snapshot).toMatchObject({
      filesAnalyzed: primary.snapshot.filesAnalyzed,
      truncated: primary.snapshot.truncated,
    });
  });
});

describe("D.11 credential and ignore rules", () => {
  it("excludes .env but allows .env.example", () => {
    expect(isCredentialDeniedBasename(".env")).toBe(true);
    expect(isCredentialDeniedBasename(".env.local")).toBe(true);
    expect(isCredentialDeniedBasename(".env.example")).toBe(false);
  });

  it("counts credentialsSkipped without exposing values", () => {
    const root = mkdtempSync(join(tmpdir(), "seq-d11-secret-files-"));
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=super-secret-value\n");
    writeFileSync(join(root, ".env.example"), "OPENAI_API_KEY=\n");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n".repeat(10));

    const listing = listWorkspaceFiles(root);
    expect(listing.stats.credentialsSkipped).toBeGreaterThan(0);
    expect(listing.files.some((file) => file.relativePath === ".env")).toBe(false);
    expect(listing.files.some((file) => file.relativePath === ".env.example")).toBe(true);
    expect(JSON.stringify(listing)).not.toContain("super-secret-value");
  });

  it("excludes .pem files", () => {
    const root = mkdtempSync(join(tmpdir(), "seq-d11-pem-"));
    writeFileSync(join(root, "cert.pem"), "-----BEGIN PRIVATE KEY-----\n");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n".repeat(10));
    expect(isIgnoredRelativePath("cert.pem", root)).toBe(true);
  });

  it("skips binary files during read", () => {
    const root = mkdtempSync(join(tmpdir(), "seq-d11-binary-"));
    writeFileSync(join(root, "blob.bin"), Buffer.from([0, 1, 2, 0]));
    expect(() => readWorkspaceTextFile(root, "blob.bin")).toThrow(/binary_file/);
  });
});

describe("D.11 snapshot limits", () => {
  it("uses limits aligned with the GitHub tarball fetch and the scanner", () => {
    expect(LOCAL_SCAN_LIMITS.maxFiles).toBe(8_000);
    expect(LOCAL_SCAN_LIMITS.maxFileBytes).toBe(1024 * 1024);
    expect(LOCAL_SCAN_LIMITS.maxTotalBytes).toBe(40 * 1024 * 1024);
    expect(LOCAL_SCAN_LIMITS.maxDepth).toBe(18);
  });

  it("marks oversized files as truncated and fails closed", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-d11-large-file-"));
    writeFileSync(join(root, "small.ts"), "export const ok = true;\n".repeat(20));
    writeFileSync(join(root, "large.ts"), "x".repeat(LOCAL_SCAN_LIMITS.maxFileBytes + 1));

    const result = await runLocalProductionVerdict({ workspacePath: root, scope: "workspace" });
    expect(result.snapshot.truncated).toBe(true);
    expect(result.verdictStatus).toBe("insufficient_data");
    expect(result.verdictStatus).not.toBe("ready_to_ship");
  });

  it("respects max file count", () => {
    const root = mkdtempSync(join(tmpdir(), "seq-d11-many-files-"));
    const maxFiles = 5;
    for (let index = 0; index < maxFiles + 5; index += 1) {
      writeFileSync(join(root, `file-${index}.ts`), `export const v${index} = ${index};\n`);
    }
    const listing = listWorkspaceFiles(root, { maxFiles });
    expect(listing.files.length).toBeLessThanOrEqual(maxFiles);
    expect(listing.truncated).toBe(true);
  });

  it("respects max depth", () => {
    const root = mkdtempSync(join(tmpdir(), "seq-d11-depth-"));
    let current = root;
    for (let depth = 0; depth < LOCAL_SCAN_LIMITS.maxDepth + 3; depth += 1) {
      current = join(current, `d${depth}`);
      mkdirSync(current, { recursive: true });
      writeFileSync(join(current, "leaf.ts"), "export const leaf = true;\n");
    }
    const listing = listWorkspaceFiles(root);
    expect(listing.truncated).toBe(true);
  });
});

describe("D.11 git scopes and non-git projects", () => {
  it("supports non-git workspace scope", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-d11-nogit-"));
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n".repeat(15));
    const result = await runLocalProductionVerdict({ workspacePath: root, scope: "workspace" });
    expect(result.gitAvailable).toBe(false);
    expect(result.snapshot.filesAnalyzed).toBeGreaterThan(0);
  });

  it("reports git metadata for untracked files", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-d11-untracked-"));
    if (!initGitRepo(root)) return;
    writeFileSync(join(root, "tracked.ts"), "export const base = 1;\n".repeat(10));
    execFileSync("git", ["add", "tracked.ts"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "base"], { cwd: root, stdio: "ignore" });
    writeFileSync(join(root, "new.ts"), "export const fresh = 2;\n".repeat(10));

    const result = await runLocalProductionVerdict({ workspacePath: root, scope: "working_tree" });
    expect(result.git.untrackedFiles).toBeGreaterThan(0);
    expect(result.snapshot.filesAnalyzed).toBeGreaterThan(0);
  });
});

describe("D.11 response contract", () => {
  it("includes snapshot and git metadata without source contents", async () => {
    const root = mkdtempSync(join(tmpdir(), "seq-d11-contract-"));
    const fakeStripeSecret = ["sk_", "live_", "abcdefghijklmnopqrstuvwxyz123456"].join("");
    writeFileSync(
      join(root, "secret.ts"),
      `export const token = "${fakeStripeSecret}";\n`.repeat(3)
    );
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n".repeat(20));

    const result = await runLocalProductionVerdict({ workspacePath: root, scope: "workspace" });
    expect(result.snapshot).toMatchObject({
      filesAnalyzed: expect.any(Number),
      filesExcluded: expect.any(Number),
      bytesAnalyzed: expect.any(Number),
      truncated: expect.any(Boolean),
      credentialsSkipped: expect.any(Number),
    });
    expect(result.git).toMatchObject({
      modifiedFiles: expect.any(Number),
      untrackedFiles: expect.any(Number),
      deletedFiles: expect.any(Number),
    });
    expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(result.productionVerdict).toMatchObject({
      status: result.verdictStatus,
    });
  });
});
