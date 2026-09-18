import type { BenchmarkCase } from "../../types";

export const WEB_NEGATIVE_CASES: BenchmarkCase[] = [
  {
    id: "web.permissive-cors-negative-01",
    ruleId: "web.permissive-cors",
    expected: "no_detect",
    category: "web",
    language: "typescript",
    kind: "negative",
    source: "benchmark-new",
    description: "CORS middleware configured with an explicit origin allowlist.",
    files: [{ path: "server/cors.ts", content: "app.use(cors({ origin: ['https://app.sequrai.com'] }))" }],
  },
  {
    id: "web.open-redirect-negative-01",
    ruleId: "web.open-redirect",
    expected: "no_detect",
    category: "web",
    language: "typescript",
    framework: "nextjs",
    kind: "negative",
    source: "existing-rule-test",
    description: "Literal redirect destination -- request.url used only as new URL()'s base argument (Phase 31.1 describe block, rules.test.ts).",
    files: [{ path: "app/api/checkout/route.ts", content: "export function GET() { return NextResponse.redirect(new URL('/dashboard', request.url)); }" }],
  },
  {
    id: "web.open-redirect-negative-02",
    ruleId: "web.open-redirect",
    expected: "no_detect",
    category: "web",
    language: "typescript",
    framework: "nextjs",
    kind: "negative",
    source: "existing-rule-test",
    description: "redirect() argument is a member expression unrelated to the request (a Stripe session URL) (Phase 31.1 describe block, rules.test.ts).",
    files: [
      {
        path: "app/api/checkout/route.ts",
        content: "export async function GET() { const session = await stripe.checkout.sessions.retrieve(id); redirect(session.url); }",
      },
    ],
  },
  {
    id: "web.csrf-missing-negative-01",
    ruleId: "web.csrf-missing",
    expected: "no_detect",
    category: "web",
    language: "typescript",
    framework: "nextjs",
    kind: "negative",
    source: "existing-rule-test",
    description: "RFC 7009-mandated public OAuth token revocation endpoint -- machine endpoint, excluded by design (known-safe-patterns.test.ts).",
    files: [
      {
        path: "app/oauth/revoke/route.ts",
        content: `
          export async function POST(request: Request) {
            await revokeOAuthToken({ token });
            return new NextResponse(null, { status: 200 });
          }
        `,
      },
    ],
  },
  {
    id: "next.security-headers-negative-01",
    ruleId: "next.security-headers",
    expected: "no_detect",
    category: "web",
    language: "javascript",
    framework: "nextjs",
    kind: "negative",
    source: "benchmark-new",
    description: "next.config.js headers() sets all three required security headers.",
    files: [
      {
        path: "next.config.js",
        content:
          "module.exports = { async headers() { return [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: \"default-src 'self'\" }, { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'no-referrer' }] }]; } };",
      },
    ],
  },
];
