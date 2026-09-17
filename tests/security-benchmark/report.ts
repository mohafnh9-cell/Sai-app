import { excludedOutcomes, gatedOutcomes } from "./runner";
import type { BenchmarkResult, CaseOutcome } from "./types";

export interface MachineReadableReport {
  totals: BenchmarkResult["totals"];
  rules: BenchmarkResult["ruleTallies"];
  categories: BenchmarkResult["categoryTallies"];
  regressions: { caseId: string; ruleId: string; reason: "unexpected_no_detect" | "unexpected_detect" | "severity_mismatch" }[];
  falsePositives: { caseId: string; ruleId: string; description: string }[];
  falseNegatives: { caseId: string; ruleId: string; description: string }[];
  edgeCases: { caseId: string; ruleId: string; classification: CaseOutcome["classification"]; description: string }[];
  excluded: { caseId: string; ruleId: string; reason: string }[];
}

/** Never invents numbers -- every field here is read straight off a real BenchmarkResult (from runBenchmark, which itself only ever calls the real scanRepository()). Excluded cases (BenchmarkCase.excludedReason) are still classified and counted in totals/tallies, but never contribute to `regressions`. */
export function toMachineReadableReport(result: BenchmarkResult): MachineReadableReport {
  const regressions: MachineReadableReport["regressions"] = [];
  for (const outcome of gatedOutcomes(result)) {
    if (outcome.case.expected === "detect" && outcome.classification === "FN") {
      regressions.push({ caseId: outcome.case.id, ruleId: outcome.case.ruleId, reason: "unexpected_no_detect" });
    } else if (outcome.case.expected === "no_detect" && outcome.classification === "FP") {
      regressions.push({ caseId: outcome.case.id, ruleId: outcome.case.ruleId, reason: "unexpected_detect" });
    } else if (outcome.severityMismatch) {
      regressions.push({ caseId: outcome.case.id, ruleId: outcome.case.ruleId, reason: "severity_mismatch" });
    }
  }

  const falsePositives = result.outcomes
    .filter((o) => o.classification === "FP")
    .map((o) => ({ caseId: o.case.id, ruleId: o.case.ruleId, description: o.case.description }));
  const falseNegatives = result.outcomes
    .filter((o) => o.classification === "FN")
    .map((o) => ({ caseId: o.case.id, ruleId: o.case.ruleId, description: o.case.description }));
  const edgeCases = result.outcomes
    .filter((o) => o.case.kind === "edge")
    .map((o) => ({ caseId: o.case.id, ruleId: o.case.ruleId, classification: o.classification, description: o.case.description }));
  const excluded = excludedOutcomes(result).map((o) => ({
    caseId: o.case.id,
    ruleId: o.case.ruleId,
    reason: o.case.excludedReason ?? "",
  }));

  return {
    totals: result.totals,
    rules: result.ruleTallies,
    categories: result.categoryTallies,
    regressions,
    falsePositives,
    falseNegatives,
    edgeCases,
    excluded,
  };
}

function rate(value: number | undefined): string {
  return value === undefined ? "N/A" : value.toFixed(4);
}

export function toHumanReadableReport(result: BenchmarkResult): string {
  const machine = toMachineReadableReport(result);
  const lines: string[] = [];

  lines.push("SEQURAI DETECTION BENCHMARK");
  lines.push("");
  lines.push("SUMMARY");
  lines.push(`Fixtures: ${result.outcomes.length}`);
  lines.push(`Covered (gated): ${gatedOutcomes(result).length}`);
  lines.push(`Excluded/unverified: ${machine.excluded.length}`);
  lines.push(`Positive cases: ${result.totals.positiveCases}`);
  lines.push(`Negative cases: ${result.totals.negativeCases}`);
  lines.push(`TP: ${result.totals.truePositives}`);
  lines.push(`FP: ${result.totals.falsePositives}`);
  lines.push(`FN: ${result.totals.falseNegatives}`);
  lines.push(`TN: ${result.totals.trueNegatives}`);
  const overallPrecisionDenom = result.totals.truePositives + result.totals.falsePositives;
  const overallRecallDenom = result.totals.truePositives + result.totals.falseNegatives;
  lines.push(`Precision: ${overallPrecisionDenom > 0 ? rate(result.totals.truePositives / overallPrecisionDenom) : "N/A"}`);
  lines.push(`Recall: ${overallRecallDenom > 0 ? rate(result.totals.truePositives / overallRecallDenom) : "N/A"}`);
  lines.push("");

  lines.push("BY CATEGORY");
  for (const tally of result.categoryTallies) {
    lines.push(
      `  ${tally.category}: cases=${tally.positiveCases + tally.negativeCases} TP=${tally.truePositives} FP=${tally.falsePositives} FN=${tally.falseNegatives} precision=${rate(tally.precision)} recall=${rate(tally.recall)}`
    );
  }
  lines.push("");

  lines.push("BY RULE");
  for (const tally of result.ruleTallies) {
    lines.push(
      `  ${tally.ruleId}: cases=${tally.positiveCases + tally.negativeCases} TP=${tally.truePositives} FP=${tally.falsePositives} FN=${tally.falseNegatives} TN=${tally.negativeCases - tally.falsePositives} precision=${rate(tally.precision)} recall=${rate(tally.recall)}`
    );
  }
  lines.push("");

  lines.push("FALSE POSITIVES");
  if (machine.falsePositives.length === 0) lines.push("  none");
  else for (const fp of machine.falsePositives) lines.push(`  ${fp.ruleId} (${fp.caseId}): ${fp.description}`);
  lines.push("");

  lines.push("FALSE NEGATIVES");
  if (machine.falseNegatives.length === 0) lines.push("  none");
  else for (const fn of machine.falseNegatives) lines.push(`  ${fn.ruleId} (${fn.caseId}): ${fn.description}`);
  lines.push("");

  lines.push("EDGE CASES");
  if (machine.edgeCases.length === 0) lines.push("  none");
  else for (const edge of machine.edgeCases) lines.push(`  ${edge.ruleId} (${edge.caseId}) [${edge.classification}]: ${edge.description}`);
  lines.push("");

  lines.push("NOT COVERED");
  lines.push("  See tests/security-benchmark/BLIND_SPOTS.md (IDOR/BOLA, race conditions, business-logic chains -- no rule id exists to fixture).");
  lines.push("");

  lines.push("EXCLUDED / UNVERIFIED");
  if (machine.excluded.length === 0) lines.push("  none");
  else for (const item of machine.excluded) lines.push(`  ${item.ruleId} (${item.caseId}): ${item.reason}`);
  lines.push("");

  lines.push("REGRESSIONS");
  if (machine.regressions.length === 0) lines.push("  none");
  else for (const regression of machine.regressions) lines.push(`  ${regression.ruleId} (${regression.caseId}): ${regression.reason}`);

  return lines.join("\n");
}
