import { describe, expect, it } from "vitest";
import { ALL_BENCHMARK_CASES } from "../all-cases";
import { toHumanReadableReport, toMachineReadableReport } from "../report";
import { excludedOutcomes, gatedOutcomes, runBenchmark } from "../runner";

/**
 * This is the CI regression gate for detection accuracy: every case in
 * ../cases/* is run through the REAL scanRepository() (no mocking, no
 * second scanning path) and its actual outcome is compared against its
 * own `expected` contract. A rule change that turns a previously-detected
 * positive case into a miss, or a previously-safe negative case into a
 * false positive, fails here -- see master prompt section 10 (case-level
 * regression, not a rigid global threshold).
 */
describe("SequrAI detection benchmark: case-level regression gate", () => {
  it("every non-excluded positive case is still detected by its own ruleId", async () => {
    const result = await runBenchmark(ALL_BENCHMARK_CASES);
    const unexpectedMisses = gatedOutcomes(result).filter(
      (outcome) => outcome.case.expected === "detect" && outcome.classification === "FN"
    );
    expect(unexpectedMisses.map((o) => o.case.id)).toEqual([]);
  });

  it("every non-excluded negative case is still free of its watched ruleId (no false-positive regression)", async () => {
    const result = await runBenchmark(ALL_BENCHMARK_CASES);
    const unexpectedFlags = gatedOutcomes(result).filter(
      (outcome) => outcome.case.expected === "no_detect" && outcome.classification === "FP"
    );
    expect(unexpectedFlags.map((o) => o.case.id)).toEqual([]);
  });

  it("every non-excluded positive case with a severity contract still matches that severity", async () => {
    const result = await runBenchmark(ALL_BENCHMARK_CASES);
    const mismatches = gatedOutcomes(result).filter((outcome) => outcome.severityMismatch);
    expect(mismatches.map((o) => ({ id: o.case.id, mismatch: o.severityMismatch }))).toEqual([]);
  });

  it("every case marked excludedReason (if any exist) is still classified, not silently dropped, and carries a real reason", async () => {
    // As of the Detection Accuracy Hardening V1 pass, zero fixtures are
    // excluded -- both confirmed false positives (web.next-xss,
    // mcp.fs-write-no-path-validation) were root-caused and fixed rather
    // than merely documented. This assertion stays generic (not
    // "length > 0") so it keeps proving the mechanism -- gatedOutcomes +
    // excludedOutcomes always partition every outcome exactly once, and
    // any future excluded case is still tracked, not dropped -- without
    // hard-coding today's zero count as a permanent expectation.
    const result = await runBenchmark(ALL_BENCHMARK_CASES);
    const excluded = excludedOutcomes(result);
    const gated = gatedOutcomes(result);
    expect(gated.length + excluded.length).toBe(result.outcomes.length);
    for (const outcome of excluded) {
      expect(outcome.case.excludedReason).toBeTruthy();
    }
  });

  it("produces a machine-readable report with no invented numbers (every count traces to a real case outcome)", async () => {
    const result = await runBenchmark(ALL_BENCHMARK_CASES);
    const machine = toMachineReadableReport(result);
    const recomputedPositive = ALL_BENCHMARK_CASES.filter((c) => c.expected === "detect").length;
    const recomputedNegative = ALL_BENCHMARK_CASES.filter((c) => c.expected === "no_detect").length;
    expect(machine.totals.positiveCases).toBe(recomputedPositive);
    expect(machine.totals.negativeCases).toBe(recomputedNegative);
    expect(
      machine.totals.truePositives + machine.totals.falseNegatives
    ).toBe(recomputedPositive);
    expect(
      machine.totals.falsePositives + machine.totals.trueNegatives
    ).toBe(recomputedNegative);
  });

  it("prints a human-readable report (smoke test, explicitly invoked -- not part of production scans)", async () => {
    const result = await runBenchmark(ALL_BENCHMARK_CASES);
    const text = toHumanReadableReport(result);
    expect(text).toContain("SEQURAI DETECTION BENCHMARK");
    expect(text).toContain(`Positive cases: ${result.totals.positiveCases}`);
    console.log(text);
  });
});
