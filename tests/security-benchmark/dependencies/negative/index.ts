import type { BenchmarkCase } from "../../types";

export const DEPENDENCIES_NEGATIVE_CASES: BenchmarkCase[] = [
  {
    id: "dependencies.local-catalog-negative-01",
    ruleId: "dependencies.local-catalog",
    expected: "no_detect",
    category: "dependencies",
    language: "json",
    kind: "negative",
    source: "benchmark-new",
    description: "package.json depends only on ordinary, non-catalog-listed, registry-pinned packages.",
    files: [{ path: "package.json", content: '{"dependencies":{"next":"14.2.5","react":"18.3.1"}}' }],
  },
];
