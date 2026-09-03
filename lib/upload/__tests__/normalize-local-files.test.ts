import { describe, expect, it } from "vitest";
import { normalizeLocalFiles, LocalFilesValidationError } from "../normalize-local-files";
import { SOURCE_ANALYSIS_LIMITS } from "../source-limits";

const DEFAULT_LIMITS = {
  maxFiles: 100,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxDepth: 12,
};

function file(path: string, content: string) {
  return { path, content: Buffer.from(content, "utf8") };
}

describe("normalizeLocalFiles", () => {
  it("normalizes a normal local project (webkitRelativePath-shaped entries)", () => {
    const result = normalizeLocalFiles(
      [
        file("my-app/package.json", '{"name":"my-app"}'),
        file("my-app/src/index.ts", "export const x = 1;"),
      ],
      DEFAULT_LIMITS
    );
    expect(result.files.map((f) => f.path).sort()).toEqual([
      "my-app/package.json",
      "my-app/src/index.ts",
    ]);
  });

  it("rejects an empty selection", () => {
    expect(() => normalizeLocalFiles([], DEFAULT_LIMITS)).toThrow(LocalFilesValidationError);
    try {
      normalizeLocalFiles([], DEFAULT_LIMITS);
    } catch (e) {
      expect((e as LocalFilesValidationError).code).toBe("empty_project");
    }
  });

  it("rejects a selection with no supported source files", () => {
    expect(() =>
      normalizeLocalFiles([file("my-app/node_modules/x/index.js", "module.exports={}")], DEFAULT_LIMITS)
    ).toThrow(LocalFilesValidationError);
  });

  it("rejects ../ traversal in a client-supplied relative path", () => {
    const result = normalizeLocalFiles(
      [file("../../etc/passwd", "root:x:0:0"), file("app/safe.ts", "export {};")],
      DEFAULT_LIMITS
    );
    expect(result.files.map((f) => f.path)).toEqual(["app/safe.ts"]);
  });

  it("enforces maxFileBytes on an oversized file", () => {
    const result = normalizeLocalFiles(
      [file("app/huge.ts", "a".repeat(5000)), file("app/small.ts", "ok")],
      { ...DEFAULT_LIMITS, maxFileBytes: 1000 }
    );
    expect(result.files.map((f) => f.path)).toEqual(["app/small.ts"]);
    expect(result.omissions.some((o) => o.reason === "max_file_size")).toBe(true);
  });

  it("enforces maxTotalBytes across real content", () => {
    const big = "a".repeat(5000);
    const result = normalizeLocalFiles(
      [file("app/a.ts", big), file("app/b.ts", big), file("app/c.ts", big)],
      { ...DEFAULT_LIMITS, maxTotalBytes: 6000 }
    );
    const kept = result.files.reduce((sum, f) => sum + f.size, 0);
    expect(kept).toBeLessThanOrEqual(6000);
  });

  it("enforces maxFiles across many entries", () => {
    const entries = Array.from({ length: 20 }, (_, i) => file(`app/file-${i}.ts`, `export const n = ${i};`));
    const result = normalizeLocalFiles(entries, { ...DEFAULT_LIMITS, maxFiles: 5 });
    expect(result.files).toHaveLength(5);
    expect(result.omissions.some((o) => o.reason === "max_file_count")).toBe(true);
  });

  it("silently skips binary content while keeping real source", () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    const result = normalizeLocalFiles(
      [
        { path: "app/logo.png", content: binary },
        file("app/index.ts", "export const app = true;"),
      ],
      DEFAULT_LIMITS
    );
    expect(result.files.map((f) => f.path)).toEqual(["app/index.ts"]);
  });

  it("scans .env content for secret findings the same way GitHub/upload do (no special exclusion)", () => {
    const result = normalizeLocalFiles(
      [file("app/.env", "API_KEY=sk_live_abc123"), file("app/index.ts", "export {};")],
      DEFAULT_LIMITS
    );
    expect(result.files.map((f) => f.path)).toContain("app/.env");
  });

  it("flags package.json as a critical file the same way the ZIP path does", () => {
    const result = normalizeLocalFiles(
      [file("app/package.json", '{"name":"x"}'), file("app/index.ts", "export {};")],
      DEFAULT_LIMITS
    );
    expect(result.omissions.some((o) => o.reason === "critical_file_detected")).toBe(true);
  });

  it("rejects an unreasonably large entry count before processing", () => {
    const entries = Array.from({ length: 1001 }, (_, i) => file(`app/f${i}.ts`, "x"));
    expect(() => normalizeLocalFiles(entries, { ...DEFAULT_LIMITS, maxFiles: 100 })).toThrow(
      LocalFilesValidationError
    );
  });

  describe("against the real canonical SOURCE_ANALYSIS_LIMITS (Phase 11.1 regression)", () => {
    it("accepts a local project below the canonical total-source-size limit", () => {
      // Well under SOURCE_ANALYSIS_LIMITS.maxTotalBytes (40MB) -- the same
      // budget ZIP upload gets, not a smaller local-only ceiling.
      const result = normalizeLocalFiles(
        [file("app/index.ts", "a".repeat(1000)), file("app/util.ts", "b".repeat(1000))],
        SOURCE_ANALYSIS_LIMITS
      );
      expect(result.files).toHaveLength(2);
    });

    it("rejects a local project above the canonical total-source-size limit", () => {
      const oversized = "a".repeat(SOURCE_ANALYSIS_LIMITS.maxFileBytes);
      const fileCountNeeded = Math.ceil(SOURCE_ANALYSIS_LIMITS.maxTotalBytes / oversized.length) + 1;
      const entries = Array.from({ length: fileCountNeeded }, (_, i) => file(`app/f${i}.ts`, oversized));

      const result = normalizeLocalFiles(entries, SOURCE_ANALYSIS_LIMITS);

      const keptBytes = result.files.reduce((sum, f) => sum + f.size, 0);
      expect(keptBytes).toBeLessThanOrEqual(SOURCE_ANALYSIS_LIMITS.maxTotalBytes);
      expect(result.omissions.some((o) => o.reason === "max_total_size")).toBe(true);
    });
  });
});
