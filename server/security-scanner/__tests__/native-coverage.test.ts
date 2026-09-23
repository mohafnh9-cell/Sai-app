import { describe, expect, it } from "vitest";
import {
  countDroppedRelevantFiles,
  hasIncompleteNativeRuleCoverage,
  isIncrementalScan,
} from "../native-coverage";

// Phase Z v2 Pass 3 (CRIT-006 / Part 7): a rule that crashed or never ran is
// missing evidence, never "found nothing".
describe("hasIncompleteNativeRuleCoverage", () => {
  it("is false for a clean scan (no failures, only by-design omissions)", () => {
    expect(
      hasIncompleteNativeRuleCoverage({
        metrics: { rulesRun: 47, ruleFailures: 0 },
        omissions: [{ reason: "binary_file" }, { reason: "critical_file_detected" }, { reason: "ignored" }],
      })
    ).toBe(false);
  });

  it("is true when a native rule threw", () => {
    expect(hasIncompleteNativeRuleCoverage({ metrics: { rulesRun: 46, ruleFailures: 1 }, omissions: [] })).toBe(true);
  });

  it("is true when several native rules threw", () => {
    expect(hasIncompleteNativeRuleCoverage({ metrics: { rulesRun: 40, ruleFailures: 7 }, omissions: [] })).toBe(true);
  });

  it("is true when an omission records a rule error even if the counter is absent", () => {
    expect(
      hasIncompleteNativeRuleCoverage({
        metrics: { rulesRun: 46 },
        omissions: [{ reason: "rule-error", ruleId: "authz.ownership", detail: "TypeError" }],
      })
    ).toBe(true);
  });

  it("is true when rules were skipped because the time budget ran out", () => {
    expect(
      hasIncompleteNativeRuleCoverage({ metrics: { ruleFailures: 0 }, omissions: [{ reason: "time-limit" }] })
    ).toBe(true);
  });

  it("treats malformed failure data as incomplete, never as clean", () => {
    expect(hasIncompleteNativeRuleCoverage({ metrics: { ruleFailures: "unknown" } })).toBe(true);
    expect(hasIncompleteNativeRuleCoverage({ metrics: { ruleFailures: Number.NaN } })).toBe(true);
    expect(hasIncompleteNativeRuleCoverage({ metrics: {}, omissions: "oops" })).toBe(true);
    expect(hasIncompleteNativeRuleCoverage({ metrics: {}, omissions: [null] })).toBe(true);
  });

  it("does not flag scans that recorded nothing at all (older scans cannot be judged)", () => {
    expect(hasIncompleteNativeRuleCoverage({})).toBe(false);
    expect(hasIncompleteNativeRuleCoverage({ metrics: null, omissions: null })).toBe(false);
    expect(hasIncompleteNativeRuleCoverage({ metrics: {}, omissions: [] })).toBe(false);
  });
});

describe("countDroppedRelevantFiles", () => {
  it("counts relevant files dropped by depth/size/count limits, explicit and aggregated", () => {
    expect(
      countDroppedRelevantFiles([
        { path: "a.ts", reason: "max_file_size" },
        { path: "b.ts", reason: "max_depth" },
        { reason: "max_file_count", count: 40 },
        { path: "c.ts", reason: "max_total_size" },
      ])
    ).toBe(43);
  });

  it("ignores files dropped by design (binary, ignored, generated, critical-file marker)", () => {
    expect(
      countDroppedRelevantFiles([
        { path: "logo.png", reason: "binary_extension" },
        { path: "node_modules/x.js", reason: "ignored_path" },
        { path: "bundle.min.js", reason: "generated_file" },
        { path: ".env", reason: "critical_file_detected" },
      ])
    ).toBe(0);
  });

  it("handles missing input", () => {
    expect(countDroppedRelevantFiles(null)).toBe(0);
    expect(countDroppedRelevantFiles(undefined)).toBe(0);
    expect(countDroppedRelevantFiles([])).toBe(0);
  });
});

describe("isIncrementalScan", () => {
  it("recognises the scan_type column and the metrics marker", () => {
    expect(isIncrementalScan({ scan_type: "incremental" })).toBe(true);
    expect(isIncrementalScan({ metrics: { scanType: "incremental" } })).toBe(true);
  });

  it("is false for full scans and unknown scans (they may never borrow prior coverage)", () => {
    expect(isIncrementalScan({ scan_type: "full" })).toBe(false);
    expect(isIncrementalScan({ metrics: { scanType: "full" } })).toBe(false);
    expect(isIncrementalScan({})).toBe(false);
  });
});
