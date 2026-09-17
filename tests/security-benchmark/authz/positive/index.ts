import type { BenchmarkCase } from "../../types";

export const AUTHZ_POSITIVE_CASES: BenchmarkCase[] = [
  {
    id: "authz.insufficient-positive-01",
    ruleId: "authz.insufficient",
    expected: "detect",
    category: "authz",
    language: "typescript",
    framework: "nextjs",
    severity: "medium",
    kind: "positive",
    source: "existing-rule-test",
    description: "A mutating route with no ownership, role, or policy check anywhere in the file (known-safe-patterns.test.ts's 'genuinely unprotected mutating route' fixture).",
    files: [
      {
        path: "app/api/widgets/route.ts",
        content: "export async function POST(request: Request) {\n  const body = await request.json();\n  await db.widgets.insert(body);\n  return NextResponse.json({ ok: true });\n}",
      },
    ],
  },
  {
    id: "frontend.client-authz-positive-01",
    ruleId: "frontend.client-authz",
    expected: "detect",
    category: "authz",
    language: "typescript",
    framework: "react",
    severity: "high",
    kind: "positive",
    source: "benchmark-new",
    description: "Role check performed only in client UI code with no server enforcement in view.",
    files: [{ path: "components/AdminPanel.tsx", content: "if (user.role !== 'admin') { return null; }\nreturn <AdminDashboard />;" }],
  },
];
