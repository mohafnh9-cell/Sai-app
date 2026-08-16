import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveAuthorizedWorkspacePath,
  WorkspaceBoundaryError,
} from "../workspace";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("resolveAuthorizedWorkspacePath", () => {
  it("allows the same authorized directory", () => {
    const root = makeTempDir("sequrai-root-");
    expect(resolveAuthorizedWorkspacePath(root)).toBe(
      resolveAuthorizedWorkspacePath(root, root)
    );
  });

  it("allows a nested directory inside the authorized root", () => {
    const root = makeTempDir("sequrai-root-");
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });
    const resolved = resolveAuthorizedWorkspacePath(root, "packages/app");
    expect(resolved.endsWith(`${join("packages", "app")}`)).toBe(true);
  });

  it("rejects parent traversal with ..", () => {
    const root = makeTempDir("sequrai-root-");
    mkdirSync(join(root, "child"), { recursive: true });
    expect(() =>
      resolveAuthorizedWorkspacePath(root, join("child", "..", ".."))
    ).toThrow(WorkspaceBoundaryError);
  });

  it("rejects double parent traversal", () => {
    const root = makeTempDir("sequrai-root-");
    expect(() => resolveAuthorizedWorkspacePath(root, "../../etc")).toThrow(
      WorkspaceBoundaryError
    );
  });

  it("rejects encoded parent traversal", () => {
    const root = makeTempDir("sequrai-root-");
    expect(() => resolveAuthorizedWorkspacePath(root, "..%2F..%2Fetc")).toThrow(
      WorkspaceBoundaryError
    );
  });

  it("rejects absolute paths outside the authorized root", () => {
    const root = makeTempDir("sequrai-root-");
    const outside = makeTempDir("sequrai-outside-");
    expect(() => resolveAuthorizedWorkspacePath(root, outside)).toThrow(
      WorkspaceBoundaryError
    );
  });

  it("allows absolute paths inside the authorized root", () => {
    const root = makeTempDir("sequrai-root-");
    const nested = join(root, "src");
    mkdirSync(nested);
    expect(resolveAuthorizedWorkspacePath(root, nested)).toBe(
      resolveAuthorizedWorkspacePath(root, "src")
    );
  });

  it("rejects symlink escapes pointing outside the authorized root", () => {
    const root = makeTempDir("sequrai-root-");
    const outside = makeTempDir("sequrai-outside-");
    const linkPath = join(root, "escape-link");
    try {
      symlinkSync(outside, linkPath, "dir");
    } catch {
      execFileSync("ln", ["-s", outside, linkPath]);
    }
    expect(() => resolveAuthorizedWorkspacePath(root, "escape-link")).toThrow(
      WorkspaceBoundaryError
    );
  });

  it("allows symlinks that remain inside the authorized root", () => {
    const root = makeTempDir("sequrai-root-");
    const nested = join(root, "real");
    mkdirSync(nested);
    const linkPath = join(root, "linked");
    try {
      symlinkSync(nested, linkPath, "dir");
    } catch {
      execFileSync("ln", ["-s", nested, linkPath]);
    }
    expect(resolveAuthorizedWorkspacePath(root, "linked")).toBe(
      resolveAuthorizedWorkspacePath(root, "real")
    );
  });

  it("rejects non-existent paths", () => {
    const root = makeTempDir("sequrai-root-");
    expect(() => resolveAuthorizedWorkspacePath(root, "missing/path")).toThrow(
      WorkspaceBoundaryError
    );
  });

  it("rejects files instead of directories", () => {
    const root = makeTempDir("sequrai-root-");
    const filePath = join(root, "file.txt");
    writeFileSync(filePath, "hello");
    expect(() => resolveAuthorizedWorkspacePath(root, "file.txt")).toThrow(
      WorkspaceBoundaryError
    );
  });

  it("handles macOS-style absolute paths inside root", () => {
    if (process.platform !== "darwin") return;
    const root = makeTempDir("sequrai-root-");
    const nested = join(root, "mac-app");
    mkdirSync(nested);
    expect(resolveAuthorizedWorkspacePath(root, nested)).toContain("mac-app");
  });
});
