import type { BenchmarkCase } from "../../types";

/**
 * No authz/positive cases exist: authz.insufficient's positive side is
 * effectively the same shape as auth.missing-positive-01 (an unprotected
 * mutating route with no ownership/role/policy check) and is not
 * duplicated here; frontend.client-authz supplies the category's positive
 * coverage instead (below).
 */
export const AUTHZ_NEGATIVE_CASES: BenchmarkCase[] = [
  {
    id: "authz.insufficient-negative-01",
    ruleId: "authz.insufficient",
    expected: "no_detect",
    category: "authz",
    language: "typescript",
    framework: "nextjs",
    kind: "negative",
    source: "existing-rule-test",
    description: "A GET-only handler using a recognized auth-context helper -- rule scans the route file's own text and finds it (rules.test.ts).",
    files: [
      {
        path: "app/api/brain/organization/route.ts",
        content:
          'import { getServerAuthContext } from "@/lib/auth/dev-bypass";\nexport async function GET() {\n  const auth = await getServerAuthContext();\n  if (!auth?.organizationId) return Response.json({ error: "No organization" }, { status: 404 });\n}',
      },
    ],
  },
  {
    id: "authz.insufficient-negative-02",
    ruleId: "authz.insufficient",
    expected: "no_detect",
    category: "authz",
    language: "typescript",
    framework: "nextjs",
    kind: "negative",
    source: "existing-rule-test",
    description: "A route that delegates its access check to a named context helper (rules.test.ts).",
    files: [
      {
        path: "app/api/repositories/[repositoryId]/scans/route.ts",
        content:
          'import { getScanRequestContext } from "@/server/security-scanner/request-context";\nexport async function POST() {\n  await getScanRequestContext("id", true);\n}',
      },
    ],
  },
  {
    id: "frontend.client-authz-negative-01",
    ruleId: "frontend.client-authz",
    expected: "no_detect",
    category: "authz",
    language: "typescript",
    framework: "react",
    kind: "negative",
    source: "benchmark-new",
    description: "UI-only visibility toggle unrelated to a role/permission gate.",
    files: [{ path: "components/Sidebar.tsx", content: "if (isCollapsed) { return null; }\nreturn <ExpandedSidebar />;" }],
  },
];
