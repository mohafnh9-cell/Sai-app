import type { BenchmarkCase } from "../../types";

export const AUTH_NEGATIVE_CASES: BenchmarkCase[] = [
  {
    id: "auth.missing-negative-01",
    ruleId: "auth.missing",
    expected: "no_detect",
    category: "auth",
    language: "typescript",
    framework: "nextjs",
    kind: "negative",
    source: "existing-rule-test",
    description: "A route protected by the project's own Supabase auth context (features/security-scanner/__tests__/rules.test.ts).",
    files: [{ path: "app/api/projects/route.ts", content: 'export async function GET() {\n  const { data: { user } } = await supabase.auth.getUser();\n}' }],
  },
  {
    id: "auth.missing-negative-02",
    ruleId: "auth.missing",
    expected: "no_detect",
    category: "auth",
    language: "typescript",
    framework: "nextjs",
    kind: "negative",
    source: "existing-rule-test",
    description: "A webhook route protected by signature verification, not a session -- known Red Team false-positive regression (known-safe-patterns.test.ts).",
    files: [
      {
        path: "app/api/stripe/webhook/route.ts",
        content: `
          export async function POST(request: Request) {
            const signature = request.headers.get("stripe-signature");
            const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
            return NextResponse.json({ received: true });
          }
        `,
      },
    ],
  },
  {
    id: "auth.missing-negative-03",
    ruleId: "auth.missing",
    expected: "no_detect",
    category: "auth",
    language: "typescript",
    framework: "nextjs",
    kind: "negative",
    source: "existing-rule-test",
    description: "RFC 7591-mandated public OAuth client registration endpoint -- public by specification, not by oversight (known-safe-patterns.test.ts).",
    files: [
      {
        path: "app/oauth/register/route.ts",
        content: `
          export async function POST(request: Request) {
            const client = await registerOAuthClient(body);
            return NextResponse.json({ client_id: client.client_id }, { status: 201 });
          }
        `,
      },
    ],
  },
  {
    id: "auth.insecure-cookie-negative-01",
    ruleId: "auth.insecure-cookie",
    expected: "no_detect",
    category: "auth",
    language: "typescript",
    kind: "negative",
    source: "benchmark-new",
    description: "Cookie explicitly sets secure, httpOnly, and sameSite.",
    files: [{ path: "server/session.ts", content: "response.cookies.set('session', token, { httpOnly: true, secure: true, sameSite: 'lax' });" }],
  },
  {
    id: "auth.insecure-jwt-negative-01",
    ruleId: "auth.insecure-jwt",
    expected: "no_detect",
    category: "auth",
    language: "typescript",
    kind: "negative",
    source: "benchmark-new",
    description: "JWT verification with an explicit HMAC algorithm and no decode-only / none-algorithm / expiry-free signing calls.",
    files: [{ path: "server/jwt.ts", content: "jwt.verify(token, key, { algorithms: ['HS256'], issuer: 'sequrai', audience: 'app' });" }],
  },
  {
    id: "auth.session-client-storage-negative-01",
    ruleId: "auth.session-client-storage",
    expected: "no_detect",
    category: "auth",
    language: "typescript",
    framework: "react",
    kind: "negative",
    source: "benchmark-new",
    description: "Non-auth value stored in localStorage.",
    files: [{ path: "components/ThemeProvider.tsx", content: "localStorage.setItem('theme', theme);" }],
  },
];
