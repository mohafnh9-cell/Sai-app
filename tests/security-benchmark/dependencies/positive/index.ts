import type { BenchmarkCase } from "../../types";

export const DEPENDENCIES_POSITIVE_CASES: BenchmarkCase[] = [
  {
    id: "dependencies.local-catalog-positive-01",
    ruleId: "dependencies.local-catalog",
    expected: "detect",
    category: "dependencies",
    language: "json",
    kind: "positive",
    source: "existing-rule-test",
    description: "package.json depends on vm2 (known sandbox-escape history) and an unpinned git dependency -- catalog entries, no CVE claimed (rules.test.ts).",
    files: [{ path: "package.json", content: '{"dependencies":{"vm2":"1.0.0","other":"git+https://example.invalid/repo.git"}}' }],
  },
];
