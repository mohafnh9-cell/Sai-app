import type { BenchmarkCase } from "../../types";

export const CICD_NEGATIVE_CASES: BenchmarkCase[] = [
  {
    id: "cicd.github-actions-supply-chain-negative-sha-pinned-01",
    ruleId: "cicd.github-actions-supply-chain",
    expected: "no_detect",
    category: "cicd",
    language: "yaml",
    kind: "negative",
    source: "existing-rule-test",
    description: "A workflow step references a third-party action pinned to a full 40-character commit SHA (rules.test.ts).",
    files: [{ path: ".github/workflows/ci.yml", content: ["jobs:", "  build:", "    steps:", "      - uses: actions/checkout@a1b2c3d4e5f6789012345678901234567890abcd"].join("\n") }],
  },
  {
    id: "cicd.github-actions-permissions-negative-read-only-01",
    ruleId: "cicd.github-actions-permissions",
    expected: "no_detect",
    category: "cicd",
    language: "yaml",
    kind: "negative",
    source: "benchmark-new",
    description: "Workflow grants only read-only permissions.",
    files: [{ path: ".github/workflows/release.yml", content: "permissions:\n  contents: read\njobs:\n  release:\n    runs-on: ubuntu-latest" }],
  },
];
