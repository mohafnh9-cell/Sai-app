import { describe, expect, it } from "vitest";
import { checkLocalSelectionPreflight } from "../local-preflight";

const TEST_LIMITS = {
  maxFiles: 5,
  maxFileBytes: 1000,
  maxTotalBytes: 3000,
  maxDepth: 12,
} as const;

describe("checkLocalSelectionPreflight", () => {
  it("accepts a selection within all limits", () => {
    const files = [{ size: 100 }, { size: 200 }, { size: 300 }];
    expect(checkLocalSelectionPreflight(files, TEST_LIMITS)).toEqual({ ok: true });
  });

  it("detects an excessive file count", () => {
    const files = Array.from({ length: 6 }, () => ({ size: 10 }));
    expect(checkLocalSelectionPreflight(files, TEST_LIMITS)).toEqual({
      ok: false,
      reason: "too_many_files",
    });
  });

  it("detects an oversized individual file", () => {
    const files = [{ size: 500 }, { size: 1500 }];
    expect(checkLocalSelectionPreflight(files, TEST_LIMITS)).toEqual({
      ok: false,
      reason: "file_too_large",
    });
  });

  it("detects an oversized total project size", () => {
    const files = [{ size: 900 }, { size: 900 }, { size: 900 }, { size: 900 }];
    // 4 files x 900 bytes = 3600 > maxTotalBytes (3000), none individually over maxFileBytes (1000)
    expect(checkLocalSelectionPreflight(files, TEST_LIMITS)).toEqual({
      ok: false,
      reason: "total_too_large",
    });
  });

  it("checks file-count and per-file-size before total size (order matters for a clear message)", () => {
    // Would also fail total_too_large, but the single-file violation is the more specific, useful message.
    const files = [{ size: 1500 }, { size: 1500 }, { size: 1500 }];
    expect(checkLocalSelectionPreflight(files, TEST_LIMITS)).toEqual({
      ok: false,
      reason: "file_too_large",
    });
  });

  it("defaults to the real canonical SOURCE_ANALYSIS_LIMITS when no override is passed", async () => {
    const { SOURCE_ANALYSIS_LIMITS } = await import("../source-limits");
    const files = [{ size: SOURCE_ANALYSIS_LIMITS.maxFileBytes + 1 }];
    expect(checkLocalSelectionPreflight(files)).toEqual({ ok: false, reason: "file_too_large" });
  });

  it("warns against the real transport ceiling, not the larger (transport-unreachable) canonical source budget", async () => {
    // A project between the real transport ceiling and the aspirational
    // 40MB SOURCE_ANALYSIS_LIMITS.maxTotalBytes must still be flagged here
    // -- it would otherwise pass this preflight and then be rejected (or
    // silently truncated) by the server's real, smaller request-body limit.
    const { LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES, SOURCE_ANALYSIS_LIMITS } = await import(
      "../source-limits"
    );
    expect(LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES).toBeLessThan(SOURCE_ANALYSIS_LIMITS.maxTotalBytes);

    // Many files, each comfortably under maxFileBytes individually, whose
    // sum exceeds the transport ceiling but stays under the (larger, and
    // for Local Analysis unreachable) canonical 40MB source budget.
    const perFile = Math.floor(SOURCE_ANALYSIS_LIMITS.maxFileBytes / 2);
    const fileCount = Math.ceil((LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES + perFile) / perFile);
    const files = Array.from({ length: fileCount }, () => ({ size: perFile }));
    const totalBytes = fileCount * perFile;
    expect(totalBytes).toBeGreaterThan(LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES);
    expect(totalBytes).toBeLessThan(SOURCE_ANALYSIS_LIMITS.maxTotalBytes);

    expect(checkLocalSelectionPreflight(files)).toEqual({ ok: false, reason: "total_too_large" });
  });
});
