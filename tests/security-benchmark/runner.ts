import { scanRepository } from "@/features/security-scanner";
import type { BenchmarkCase, BenchmarkResult, BenchmarkTotals, CaseOutcome, CategoryTally, RuleTally } from "./types";

/**
 * Fails loudly on a malformed or duplicate-id fixture rather than silently
 * skipping it -- a benchmark that quietly drops a broken case is worse than
 * one that never existed, since it would report false confidence.
 */
export function validateCases(cases: readonly BenchmarkCase[]): void {
  const seenIds = new Set<string>();
  for (const benchmarkCase of cases) {
    if (!benchmarkCase.id) {
      throw new Error("Benchmark case is missing an id");
    }
    if (seenIds.has(benchmarkCase.id)) {
      throw new Error(`Duplicate benchmark case id: ${benchmarkCase.id}`);
    }
    seenIds.add(benchmarkCase.id);
    if (!benchmarkCase.ruleId) {
      throw new Error(`Benchmark case "${benchmarkCase.id}" is missing ruleId`);
    }
    if (benchmarkCase.expected !== "detect" && benchmarkCase.expected !== "no_detect") {
      throw new Error(
        `Benchmark case "${benchmarkCase.id}" has invalid expected value: ${String(benchmarkCase.expected)}`
      );
    }
    if (!Array.isArray(benchmarkCase.files) || benchmarkCase.files.length === 0) {
      throw new Error(`Benchmark case "${benchmarkCase.id}" has no files`);
    }
  }
}

export async function runCase(benchmarkCase: BenchmarkCase): Promise<CaseOutcome> {
  const result = await scanRepository(benchmarkCase.files);
  const matches = result.findings.filter((finding) => finding.ruleId === benchmarkCase.ruleId);
  const matched = matches.length > 0;
  const matchedSeverities = matches.map((finding) => finding.severity);

  const classification: CaseOutcome["classification"] =
    benchmarkCase.expected === "detect" ? (matched ? "TP" : "FN") : matched ? "FP" : "TN";

  const severityMismatch =
    classification === "TP" && benchmarkCase.severity && !matchedSeverities.includes(benchmarkCase.severity)
      ? { expected: benchmarkCase.severity, actual: matchedSeverities }
      : undefined;

  return { case: benchmarkCase, matchedSeverities, classification, severityMismatch };
}

function emptyTally<T extends { positiveCases: number; truePositives: number; falseNegatives: number; negativeCases: number; falsePositives: number }>(
  rest: Omit<T, "positiveCases" | "truePositives" | "falseNegatives" | "negativeCases" | "falsePositives">
): T {
  return { ...rest, positiveCases: 0, truePositives: 0, falseNegatives: 0, negativeCases: 0, falsePositives: 0 } as T;
}

/** Precision/recall are undefined (never 0) when their denominator is 0 -- an unmeasurable rate is not a 0% rate. */
function withRates<T extends { truePositives: number; falsePositives: number; falseNegatives: number; precision?: number; recall?: number }>(
  tally: T
): T {
  const precisionDenominator = tally.truePositives + tally.falsePositives;
  const recallDenominator = tally.truePositives + tally.falseNegatives;
  return {
    ...tally,
    precision: precisionDenominator > 0 ? tally.truePositives / precisionDenominator : undefined,
    recall: recallDenominator > 0 ? tally.truePositives / recallDenominator : undefined,
  };
}

/**
 * Runs every case through the REAL scanRepository() -- no second scanning
 * path, no mocked findings -- and classifies each as TP/FP/FN/TN against
 * its own `expected` contract. Precision/recall are computed per rule and
 * reported only where the relevant denominator is non-zero.
 */
export async function runBenchmark(cases: readonly BenchmarkCase[]): Promise<BenchmarkResult> {
  validateCases(cases);
  const outcomes = await Promise.all(cases.map(runCase));

  const byRule = new Map<string, RuleTally>();
  const byCategory = new Map<string, CategoryTally>();
  for (const outcome of outcomes) {
    const ruleId = outcome.case.ruleId;
    const category = outcome.case.category;
    const ruleTally = byRule.get(ruleId) ?? emptyTally<RuleTally>({ ruleId });
    const categoryTally = byCategory.get(category) ?? emptyTally<CategoryTally>({ category });
    if (outcome.case.expected === "detect") {
      ruleTally.positiveCases += 1;
      categoryTally.positiveCases += 1;
      if (outcome.classification === "TP") {
        ruleTally.truePositives += 1;
        categoryTally.truePositives += 1;
      } else {
        ruleTally.falseNegatives += 1;
        categoryTally.falseNegatives += 1;
      }
    } else {
      ruleTally.negativeCases += 1;
      categoryTally.negativeCases += 1;
      if (outcome.classification === "FP") {
        ruleTally.falsePositives += 1;
        categoryTally.falsePositives += 1;
      }
    }
    byRule.set(ruleId, ruleTally);
    byCategory.set(category, categoryTally);
  }

  const ruleTallies = [...byRule.values()].map(withRates).sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const categoryTallies = [...byCategory.values()].map(withRates).sort((a, b) => a.category.localeCompare(b.category));

  const totals: BenchmarkTotals = { positiveCases: 0, negativeCases: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0, trueNegatives: 0 };
  for (const outcome of outcomes) {
    if (outcome.case.expected === "detect") totals.positiveCases += 1;
    else totals.negativeCases += 1;
    if (outcome.classification === "TP") totals.truePositives += 1;
    else if (outcome.classification === "FP") totals.falsePositives += 1;
    else if (outcome.classification === "FN") totals.falseNegatives += 1;
    else totals.trueNegatives += 1;
  }

  return { outcomes, ruleTallies, categoryTallies, totals };
}

/** Cases the regression gate must NOT hard-fail on -- documented, currently-unresolved rule discrepancies (see BenchmarkCase.excludedReason). */
export function excludedOutcomes(result: BenchmarkResult): CaseOutcome[] {
  return result.outcomes.filter((outcome) => outcome.case.excludedReason !== undefined);
}

/** Cases the regression gate DOES enforce -- everything not explicitly excluded. */
export function gatedOutcomes(result: BenchmarkResult): CaseOutcome[] {
  return result.outcomes.filter((outcome) => outcome.case.excludedReason === undefined);
}
