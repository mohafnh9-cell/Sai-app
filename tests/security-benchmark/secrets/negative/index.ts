import type { BenchmarkCase } from "../../types";

export const SECRETS_NEGATIVE_CASES: BenchmarkCase[] = [
  {
    id: "secrets.exposed-negative-01",
    ruleId: "secrets.exposed",
    expected: "no_detect",
    category: "secrets",
    language: "text",
    kind: "negative",
    source: "existing-rule-test",
    description: ".env.example placeholder values are not real secrets -- known Red Team false-positive regression (rules.test.ts).",
    files: [{ path: ".env.example", content: "GITHUB_WEBHOOK_SECRET=generate-a-long-random-secret\nSUPABASE_SERVICE_ROLE_KEY=your-service-role-key" }],
  },
  {
    id: "secrets.public-env-negative-01",
    ruleId: "secrets.public-env",
    expected: "no_detect",
    category: "secrets",
    language: "text",
    kind: "negative",
    source: "benchmark-new",
    description: "A non-secret public config value under NEXT_PUBLIC_ (a URL, not a credential).",
    files: [{ path: ".env", content: "NEXT_PUBLIC_APP_URL=https://app.sequrai.com" }],
  },
];
