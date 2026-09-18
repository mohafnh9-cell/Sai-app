import type { InputFile, Severity } from "@/features/security-scanner/types";

/**
 * One ground-truth case for the detection benchmark. `expected: "detect"`
 * means scanRepository() MUST produce at least one finding with `ruleId`
 * for these files (a positive case); `expected: "no_detect"` means it must
 * produce none (a negative case, i.e. a known false-positive regression
 * guard). `ruleId` must match a real `Finding.ruleId` the scanner can
 * emit -- for the multi-check wrapper rules (mcp.*, bash.*, cron.*,
 * process_spawn.*) that is the internal check id, not the top-level
 * ScanRule id (mcp.security / agent-action.security), since that is what
 * actually appears on `Finding.ruleId` (see features/security-analysis/
 * to-finding-draft.ts).
 */
export interface BenchmarkCase {
  id: string;
  ruleId: string;
  expected: "detect" | "no_detect";
  category: string;
  language: string;
  framework?: string;
  /** Asserted only when expected === "detect" and a match is found; part of the case's regression contract when set. */
  severity?: Severity;
  description: string;
  files: InputFile[];
  /** "positive"/"negative" mirror `expected`; "edge" marks a contextual/tricky case worth its own report section regardless of expected value. */
  kind: "positive" | "negative" | "edge";
  /** Traceability: adapted from a pre-existing features/security-scanner/__tests__ assertion, or authored new for this benchmark. */
  source: "existing-rule-test" | "benchmark-new";
  /**
   * When set, this case is a documented, currently-unresolved discrepancy
   * (a known false positive/negative in the rule itself) rather than a
   * pass/fail regression assertion. The runner still classifies it (so the
   * report shows real numbers) but the regression gate does not fail on
   * it -- it is tracked in the report's "excluded" list instead, per the
   * false-positive/false-negative workflow: record first, fix later.
   */
  excludedReason?: string;
}

export type CaseClassification = "TP" | "FP" | "FN" | "TN";

export interface CaseOutcome {
  case: BenchmarkCase;
  matchedSeverities: Severity[];
  classification: CaseClassification;
  severityMismatch?: { expected: Severity; actual: Severity[] };
}

export interface RuleTally {
  ruleId: string;
  positiveCases: number;
  truePositives: number;
  falseNegatives: number;
  negativeCases: number;
  falsePositives: number;
  /** Present only when truePositives + falsePositives > 0. */
  precision?: number;
  /** Present only when truePositives + falseNegatives > 0. */
  recall?: number;
}

export interface BenchmarkTotals {
  positiveCases: number;
  negativeCases: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
}

export interface CategoryTally {
  category: string;
  positiveCases: number;
  truePositives: number;
  falseNegatives: number;
  negativeCases: number;
  falsePositives: number;
  precision?: number;
  recall?: number;
}

export interface BenchmarkResult {
  outcomes: CaseOutcome[];
  ruleTallies: RuleTally[];
  categoryTallies: CategoryTally[];
  totals: BenchmarkTotals;
}
