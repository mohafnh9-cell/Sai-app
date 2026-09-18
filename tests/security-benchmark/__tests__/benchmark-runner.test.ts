import { describe, expect, it } from "vitest";
import { ALL_BENCHMARK_CASES } from "../all-cases";
import { toMachineReadableReport } from "../report";
import { runBenchmark, runCase, validateCases } from "../runner";
import type { BenchmarkCase } from "../types";

const detectAuthMissing: BenchmarkCase = {
  id: "synthetic.auth.missing.detect",
  ruleId: "auth.missing",
  expected: "detect",
  category: "auth",
  language: "typescript",
  kind: "positive",
  source: "benchmark-new",
  description: "synthetic: an unprotected mutating route",
  files: [{ path: "app/api/synthetic-unprotected/route.ts", content: "export async function POST() {\n  return Response.json({ ok: true });\n}" }],
};

const noDetectAuthMissing: BenchmarkCase = {
  id: "synthetic.auth.missing.no_detect",
  ruleId: "auth.missing",
  expected: "no_detect",
  category: "auth",
  language: "typescript",
  kind: "negative",
  source: "benchmark-new",
  description: "synthetic: a route protected by a recognized auth helper",
  files: [
    {
      path: "app/api/synthetic-protected/route.ts",
      content: 'export async function GET() {\n  const { data: { user } } = await supabase.auth.getUser();\n}',
    },
  ],
};

describe("benchmark runner: fixture validation", () => {
  it("rejects a case missing an id", () => {
    const malformed = { ...detectAuthMissing, id: "" } as BenchmarkCase;
    expect(() => validateCases([malformed])).toThrow(/missing an id/);
  });

  it("rejects a duplicate case id", () => {
    expect(() => validateCases([detectAuthMissing, { ...detectAuthMissing }])).toThrow(/Duplicate benchmark case id/);
  });

  it("rejects an invalid expected value", () => {
    const malformed = { ...detectAuthMissing, expected: "maybe" } as unknown as BenchmarkCase;
    expect(() => validateCases([malformed])).toThrow(/invalid expected value/);
  });

  it("rejects a case with no files", () => {
    const malformed = { ...detectAuthMissing, files: [] };
    expect(() => validateCases([malformed])).toThrow(/no files/);
  });

  it("rejects a case missing ruleId", () => {
    const malformed = { ...detectAuthMissing, ruleId: "" };
    expect(() => validateCases([malformed])).toThrow(/missing ruleId/);
  });

  it("accepts a well-formed case set", () => {
    expect(() => validateCases([detectAuthMissing, noDetectAuthMissing])).not.toThrow();
  });

  it("the real fixture set (../cases) has no duplicate ids and passes validation", () => {
    expect(() => validateCases(ALL_BENCHMARK_CASES)).not.toThrow();
    const ids = ALL_BENCHMARK_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("benchmark runner: TP/FP/FN/TN classification", () => {
  it("classifies a detected positive case as TP", async () => {
    const outcome = await runCase(detectAuthMissing);
    expect(outcome.classification).toBe("TP");
  });

  it("classifies a missed positive case as FN", async () => {
    const missed: BenchmarkCase = { ...detectAuthMissing, files: [{ path: "app/api/x/route.ts", content: "export async function GET() { const { data: { user } } = await supabase.auth.getUser(); }" }] };
    const outcome = await runCase(missed);
    expect(outcome.classification).toBe("FN");
  });

  it("classifies a correctly-clean negative case as TN", async () => {
    const outcome = await runCase(noDetectAuthMissing);
    expect(outcome.classification).toBe("TN");
  });

  it("classifies an incorrectly-flagged negative case as FP", async () => {
    const wronglyFlagged: BenchmarkCase = { ...noDetectAuthMissing, files: detectAuthMissing.files };
    const outcome = await runCase(wronglyFlagged);
    expect(outcome.classification).toBe("FP");
  });
});

describe("benchmark runner: aggregation math", () => {
  it("computes precision/recall correctly for a small known set (1 TP, 1 FN, 1 FP, 1 TN)", async () => {
    const fpCase: BenchmarkCase = { ...noDetectAuthMissing, id: "synthetic.fp", files: detectAuthMissing.files };
    const fnCase: BenchmarkCase = {
      ...detectAuthMissing,
      id: "synthetic.fn",
      files: [{ path: "app/api/y/route.ts", content: 'export async function GET() { const { data: { user } } = await supabase.auth.getUser(); }' }],
    };
    const result = await runBenchmark([detectAuthMissing, noDetectAuthMissing, fpCase, fnCase]);
    const tally = result.ruleTallies.find((t) => t.ruleId === "auth.missing");
    expect(tally).toBeDefined();
    expect(tally?.truePositives).toBe(1);
    expect(tally?.falseNegatives).toBe(1);
    expect(tally?.falsePositives).toBe(1);
    expect(tally?.positiveCases).toBe(2);
    expect(tally?.negativeCases).toBe(2);
    // precision = TP / (TP + FP) = 1/2, recall = TP / (TP + FN) = 1/2
    expect(tally?.precision).toBeCloseTo(0.5);
    expect(tally?.recall).toBeCloseTo(0.5);
  });

  it("omits precision when a rule has zero positive+false-positive cases, and omits recall when zero positive+false-negative cases", async () => {
    const onlyNegative: BenchmarkCase = { ...noDetectAuthMissing, id: "synthetic.only-negative" };
    const result = await runBenchmark([onlyNegative]);
    const tally = result.ruleTallies.find((t) => t.ruleId === "auth.missing");
    expect(tally?.precision).toBeUndefined();
    expect(tally?.recall).toBeUndefined();
  });

  it("machine-readable report never fabricates a regression when none occurred", async () => {
    const result = await runBenchmark([detectAuthMissing, noDetectAuthMissing]);
    const machine = toMachineReadableReport(result);
    expect(machine.regressions).toEqual([]);
  });

  it("machine-readable report surfaces a regression when a negative case is unexpectedly flagged", async () => {
    const fpCase: BenchmarkCase = { ...noDetectAuthMissing, id: "synthetic.regression-fp", files: detectAuthMissing.files };
    const result = await runBenchmark([fpCase]);
    const machine = toMachineReadableReport(result);
    expect(machine.regressions).toEqual([{ caseId: "synthetic.regression-fp", ruleId: "auth.missing", reason: "unexpected_detect" }]);
  });
});

describe("benchmark isolation from production scanning", () => {
  it("running the same case twice produces identical classification (no hidden shared state across runs)", async () => {
    const first = await runCase(detectAuthMissing);
    const second = await runCase(detectAuthMissing);
    expect(first.classification).toBe(second.classification);
    expect(first.matchedSeverities).toEqual(second.matchedSeverities);
  });

  it("the benchmark module does not export or mutate any production scan configuration", async () => {
    const runnerModule = await import("../runner");
    expect(Object.keys(runnerModule).sort()).toEqual(["excludedOutcomes", "gatedOutcomes", "runBenchmark", "runCase", "validateCases"]);
  });
});
