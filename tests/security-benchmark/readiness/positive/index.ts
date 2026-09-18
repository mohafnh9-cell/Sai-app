import type { BenchmarkCase } from "../../types";

/**
 * readiness.area-baseline and security.area-baseline are always-info,
 * presence-based COVERAGE baselines (e.g. "a package.json exists, so
 * dependency posture was evaluated") -- they do not detect vulnerable
 * code, so "no_detect" has no meaningful safe-code counterpart to assert.
 * Per the master prompt ("if a rule only has positive fixtures: report
 * coverage, not precision/recall"), these are coverage-only cases
 * confirming the baseline still fires when its trigger signal is
 * present. The runner naturally omits `precision` for a rule with zero
 * negativeCases (see report.ts's `rate()` / "N/A" rendering).
 */
export const READINESS_POSITIVE_CASES: BenchmarkCase[] = [
  {
    id: "readiness.area-baseline-coverage-01",
    ruleId: "readiness.area-baseline",
    expected: "detect",
    category: "readiness",
    language: "json",
    severity: "info",
    kind: "positive",
    source: "benchmark-new",
    description: "Coverage check: a repo with a package.json produces a dependencies-area readiness baseline.",
    files: [{ path: "package.json", content: '{"name":"sample-app","dependencies":{}}' }],
  },
  {
    id: "security.area-baseline-coverage-01",
    ruleId: "security.area-baseline",
    expected: "detect",
    category: "readiness",
    language: "typescript",
    severity: "info",
    kind: "positive",
    source: "benchmark-new",
    description: "Coverage check: a repo with an auth-signal file produces an authentication-area security baseline.",
    files: [{ path: "server/auth/login.ts", content: "export async function login() {}" }],
  },
];
