import type { BenchmarkCase } from "../../types";

export const SECRETS_EDGE_CASES: BenchmarkCase[] = [
  {
    id: "secrets.exposed-edge-test-fixture-01",
    ruleId: "secrets.exposed",
    expected: "detect",
    category: "secrets",
    language: "typescript",
    severity: "info",
    kind: "edge",
    source: "existing-rule-test",
    description:
      "A real credential-SHAPED token inside a *.test.ts file is still detected, but classified TEST_FIXTURE at info severity rather than suppressed entirely -- the rule stays evidence-based, it does not silently trust the path alone (rules.test.ts).",
    files: [{ path: "app/auth/callback/__tests__/route.test.ts", content: 'const providerToken = "oauth-provider-test-token";' }],
  },
];
