import type { BenchmarkCase } from "../../types";

export const SECRETS_POSITIVE_CASES: BenchmarkCase[] = [
  {
    id: "secrets.exposed-positive-01",
    ruleId: "secrets.exposed",
    expected: "detect",
    category: "secrets",
    language: "typescript",
    kind: "positive",
    source: "existing-rule-test",
    description: "A hardcoded, production-shaped API key literal outside any test/fixture path (rules.test.ts).",
    files: [{ path: "server/config/production.ts", content: "const SERVICE_API_KEY = 'hardcoded-production-key';" }],
  },
  {
    id: "secrets.public-env-positive-01",
    ruleId: "secrets.public-env",
    expected: "detect",
    category: "secrets",
    language: "text",
    severity: "high",
    kind: "positive",
    source: "existing-rule-test",
    description: "A secret-shaped variable name exposed under the NEXT_PUBLIC_ prefix, shipped to the browser bundle (rules.test.ts).",
    files: [{ path: ".env", content: "NEXT_PUBLIC_API_SECRET=very-secret-value" }],
  },
];
