import type { BenchmarkCase } from "../../types";

export const WEB_POSITIVE_CASES: BenchmarkCase[] = [
  {
    id: "web.permissive-cors-positive-01",
    ruleId: "web.permissive-cors",
    expected: "detect",
    category: "web",
    language: "typescript",
    severity: "medium",
    kind: "positive",
    source: "existing-rule-test",
    description: "CORS middleware configured with a wildcard origin (rules.test.ts).",
    files: [{ path: "server/cors.ts", content: "app.use(cors({ origin: '*' }))" }],
  },
  {
    id: "web.next-xss-positive-01",
    ruleId: "web.next-xss",
    expected: "detect",
    category: "web",
    language: "typescript",
    framework: "react",
    severity: "high",
    kind: "positive",
    source: "existing-rule-test",
    description: "Unsanitized dangerouslySetInnerHTML rendering raw HTML (rules.test.ts).",
    files: [{ path: "components/Preview.tsx", content: "return <div dangerouslySetInnerHTML={{ __html: userHtml }} />" }],
  },
  {
    id: "web.open-redirect-positive-01",
    ruleId: "web.open-redirect",
    expected: "detect",
    category: "web",
    language: "typescript",
    framework: "nextjs",
    kind: "positive",
    source: "existing-rule-test",
    description: "Direct user input passed straight to redirect() -- NodeGoat-style reproduction (Phase 31.1 describe block, rules.test.ts).",
    files: [{ path: "app/api/checkout/route.ts", content: "export function GET(req, res) { return res.redirect(req.query.url); }" }],
  },
  {
    id: "web.csrf-missing-positive-01",
    ruleId: "web.csrf-missing",
    expected: "detect",
    category: "web",
    language: "typescript",
    framework: "nextjs",
    kind: "positive",
    source: "existing-rule-test",
    description: "A session-based OAuth authorize route (uses a browser session, not PKCE alone) with no visible CSRF protection (known-safe-patterns.test.ts).",
    files: [
      {
        path: "app/oauth/authorize/route.ts",
        content: `
          export async function POST(request: Request) {
            const { data: { user } } = await supabase.auth.getUser();
            await approveAuthorization(request);
            return NextResponse.json({ ok: true });
          }
        `,
      },
    ],
  },
  {
    id: "next.security-headers-positive-01",
    ruleId: "next.security-headers",
    expected: "detect",
    category: "web",
    language: "javascript",
    framework: "nextjs",
    severity: "low",
    kind: "positive",
    source: "benchmark-new",
    description: "next.config.js defines a headers() function but omits Content-Security-Policy, X-Content-Type-Options, and Referrer-Policy.",
    files: [
      {
        path: "next.config.js",
        content: "module.exports = { async headers() { return [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }]; } };",
      },
    ],
  },
];
