import type { BenchmarkCase } from "../../types";

/**
 * cicd.github-actions-secrets is deliberately NOT benchmarked: its
 * current pattern (`secrets\.`) matches GitHub Actions' own idiomatic,
 * safe `${{ secrets.NPM_TOKEN }}` usage as readily as a hardcoded
 * credential, so no fixture can honestly claim to be a clean "no_detect"
 * case under the rule's current logic. See ../../BLIND_SPOTS.md.
 */
export const CICD_POSITIVE_CASES: BenchmarkCase[] = [
  {
    id: "cicd.github-actions-supply-chain-positive-mutable-tag-01",
    ruleId: "cicd.github-actions-supply-chain",
    expected: "detect",
    category: "cicd",
    language: "yaml",
    kind: "positive",
    source: "existing-rule-test",
    description: "A workflow step references a third-party action by a mutable tag instead of a pinned commit SHA (rules.test.ts).",
    files: [{ path: ".github/workflows/ci.yml", content: ["jobs:", "  build:", "    steps:", "      - uses: some-org/some-action@v4"].join("\n") }],
  },
  {
    id: "cicd.github-actions-supply-chain-positive-curl-pipe-01",
    ruleId: "cicd.github-actions-supply-chain",
    expected: "detect",
    category: "cicd",
    language: "yaml",
    severity: "high",
    kind: "positive",
    source: "existing-rule-test",
    description: "A CI step pipes a remote script directly into a shell (rules.test.ts).",
    files: [{ path: ".github/workflows/ci.yml", content: ["jobs:", "  build:", "    steps:", "      - run: curl -fsSL https://get.example.com/install.sh | bash"].join("\n") }],
  },
  {
    id: "cicd.github-actions-permissions-positive-write-all-01",
    ruleId: "cicd.github-actions-permissions",
    expected: "detect",
    category: "cicd",
    language: "yaml",
    severity: "medium",
    kind: "positive",
    source: "benchmark-new",
    description: "Workflow grants write-all permissions to the default GITHUB_TOKEN.",
    files: [{ path: ".github/workflows/release.yml", content: "permissions: write-all\njobs:\n  release:\n    runs-on: ubuntu-latest" }],
  },
];
