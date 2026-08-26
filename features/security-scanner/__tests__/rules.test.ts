import { describe, expect, it } from "vitest";
import { RuleRegistry, scanRepository, type ScanRule } from "../index";

describe("critical deterministic rules", () => {
  it("finds exposed and client-public secrets with redacted evidence", async () => {
    const result = await scanRepository([
      { path: ".env", content: "STRIPE_SECRET_KEY=sk_live_abcdefghijklmnopqrstuvwxyz\nNEXT_PUBLIC_API_SECRET=very-secret-value" },
      { path: "config.ts", content: "const SERVICE_API_KEY = 'hardcoded-production-key'" },
    ]);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["secrets.exposed", "secrets.public-env"]),
    );
    expect(result.findings.map((finding) => finding.evidence).join(" ")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(result.findings.map((finding) => finding.evidence).join(" ")).not.toContain("very-secret-value");
    expect(result.findings.map((finding) => finding.evidence).join(" ")).not.toContain("hardcoded-production-key");
  });

  it("detects injection primitives", async () => {
    const result = await scanRepository([
      { path: "api/users.ts", content: "db.query(`SELECT * FROM users WHERE id = ${req.query.id}`)\nexec(`convert ${req.body.name}`)\nreadFile(req.query.path)" },
    ]);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["injection.sql", "injection.command", "injection.path-traversal"]),
    );
  });

  it("detects platform authorization and browser risks", async () => {
    const result = await scanRepository([
      { path: "database/policy.sql", content: "ALTER TABLE public.notes DISABLE ROW LEVEL SECURITY;\nCREATE POLICY open ON notes USING (true);" },
      { path: "firestore.rules", content: "allow read, write: if true;" },
      { path: "components/Preview.tsx", content: "return <div dangerouslySetInnerHTML={{ __html: userHtml }} />" },
      { path: "server/cors.ts", content: "app.use(cors({ origin: '*' }))" },
      { path: "server/jwt.ts", content: "jwt.verify(token, key, { algorithms: ['none'] })" },
    ]);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining([
        "supabase.rls", "firebase.rules", "web.next-xss", "web.permissive-cors", "auth.insecure-jwt",
      ]),
    );
  });

  it("detects a service-role reference in client code and missing RLS", async () => {
    const result = await scanRepository([
      {
        path: "components/Admin.tsx",
        content: '"use client";\nconst key = process.env.SUPABASE_SERVICE_ROLE_KEY;',
      },
      {
        path: "database/users.sql",
        content: "CREATE TABLE public.user_profiles (id uuid primary key);",
      },
    ]);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["supabase.service-role-client", "supabase.rls-missing"]),
    );
    expect(result.findings.map((finding) => finding.evidence).join(" ")).not.toContain(
      "process.env.SUPABASE_SERVICE_ROLE_KEY",
    );
  });

  it("does not flag example env files, docs, or identifier assignments as hard-coded secrets", async () => {
    const result = await scanRepository([
      {
        path: ".env.example",
        content:
          "GITHUB_WEBHOOK_SECRET=generate-a-long-random-secret\nSUPABASE_SERVICE_ROLE_KEY=your-service-role-key",
      },
      { path: "README.md", content: '"SEQURAI_API_KEY": "seq_live_...",' },
      { path: "brain/production-journey/focus.ts", content: 'secrets: "focus.secretManagement",' },
      {
        path: "brain/production-verdict/status-rules.ts",
        content: "const exposedSecret = input.findings.some((f) => f.title.includes('secret'));",
      },
      { path: "app/api/webhooks/github/route.ts", content: "const secret = webhookSecret();" },
      { path: "app/api/github/connect/route.ts", content: "accessToken: providerToken," },
      { path: "config.ts", content: "const SERVICE_API_KEY = 'hardcoded-production-key';" },
    ]);
    const exposed = result.findings.filter((finding) => finding.ruleId === "secrets.exposed");
    expect(exposed).toHaveLength(1);
    expect(exposed[0]?.location.path).toBe("config.ts");
  });

  it("classifies obvious OAuth test fixtures in test and fixture paths without blocking severity", async () => {
    const result = await scanRepository([
      {
        path: "app/auth/callback/__tests__/route.test.ts",
        content:
          'vi.mock("@/server/oauth/client");\nconst providerToken = "oauth-provider-test-token";\nconst refreshToken = "oauth-refresh-test-token";',
      },
      {
        path: "server/oauth/client.test.ts",
        content: 'const accessToken = "oauth-access-test-token";',
      },
      {
        path: "server/oauth/client.spec.ts",
        content: 'const accessToken = "oauth-access-test-token";',
      },
      {
        path: "fixtures/oauth/session-fixture.ts",
        content: 'export const refreshToken = "oauth-refresh-test-token";',
      },
    ]);
    const exposed = result.findings.filter((finding) => finding.ruleId === "secrets.exposed");
    expect(exposed.length).toBeGreaterThan(0);
    expect(
      exposed.every(
        (finding) =>
          finding.metadata?.secretClassification === "TEST_FIXTURE" && finding.severity === "info"
      )
    ).toBe(true);
  });

  it("still detects real credential formats committed inside tests", async () => {
    const githubToken = "gho_abcdefghijklmnopqrstuvwxyz123456";
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8";
    const privateKey = "-----BEGIN RSA PRIVATE KEY-----";
    const stripeKey = "sk_live_abcdefghijklmnopqrstuvwxyz";
    const result = await scanRepository([
      {
        path: "app/auth/callback/__tests__/route.test.ts",
        content: `const providerToken = "${githubToken}";`,
      },
      {
        path: "server/auth/session.test.ts",
        content: `const sessionToken = "${jwt}";`,
      },
      {
        path: "server/crypto/keys.spec.ts",
        content: `const material = "${privateKey}";`,
      },
      {
        path: "fixtures/payments/stripe.test.ts",
        content: `const apiKey = "${stripeKey}";`,
      },
    ]);
    const exposed = result.findings.filter((finding) => finding.ruleId === "secrets.exposed");
    expect(exposed.length).toBeGreaterThanOrEqual(4);
    expect(exposed.some((finding) => finding.location.path.includes("__tests__"))).toBe(true);
  });

  it("still detects hard-coded secrets outside tests", async () => {
    const result = await scanRepository([
      {
        path: "server/config/production.ts",
        content: "const SERVICE_API_KEY = 'hardcoded-production-key';",
      },
    ]);
    const exposed = result.findings.filter((finding) => finding.ruleId === "secrets.exposed");
    expect(exposed).toHaveLength(1);
    expect(exposed[0]?.location.path).toBe("server/config/production.ts");
  });

  it("does not flag routes that use project auth helpers as missing authentication", async () => {
    const result = await scanRepository([
      {
        path: "app/api/brain/organization/route.ts",
        content:
          'import { getServerAuthContext } from "@/lib/auth/dev-bypass";\nexport async function GET() {\n  const auth = await getServerAuthContext();\n}',
      },
      {
        path: "app/api/repositories/[repositoryId]/scans/route.ts",
        content:
          'import { getScanRequestContext } from "@/server/security-scanner/request-context";\nexport async function POST() {\n  await getScanRequestContext("id", true);\n}',
      },
      {
        path: "app/api/projects/route.ts",
        content:
          'export async function GET() {\n  const { data: { user } } = await supabase.auth.getUser();\n}',
      },
      {
        path: "app/api/webhooks/github/route.ts",
        content:
          'import { verifyGitHubWebhookSignature } from "@/server/github-automation/webhook-utils";\nexport async function POST(req) {\n  verifyGitHubWebhookSignature(req);\n}',
      },
      {
        path: "app/api/mcp/route.ts",
        content:
          'import { resolveMcpAuth } from "@/server/mcp/auth";\nexport async function POST(request) {\n  const auth = await resolveMcpAuth(request);\n}',
      },
      {
        path: "app/api/internal/metrics/route.ts",
        content:
          'import { assertInternalOpsAuthorized } from "@/lib/auth/internal-ops";\nexport async function GET(request) {\n  const unauthorized = assertInternalOpsAuthorized(request);\n}',
      },
      {
        path: "app/api/projects/[id]/mission-control/route.ts",
        content:
          'import { getCachedServerAuthContext } from "@/lib/server/request-cache";\nexport async function GET() {\n  const auth = await getCachedServerAuthContext();\n}',
      },
      {
        path: "app/api/projects/[id]/production-memory/route.ts",
        content:
          'import { requireProjectApiAccess } from "@/server/projects/project-access";\nexport async function GET() {\n  await supabase.auth.getUser();\n  const access = await requireProjectApiAccess(supabase, user?.id, projectId);\n}',
      },
      {
        path: "app/api/ai/fix/route.ts",
        content:
          'const deprecated = { error: "This endpoint is deprecated. Use AI analysis on scan reports via /api/scans/{scanId}/ai-analysis.", migration: "Block 5.5" };\nexport async function POST() {\n  return NextResponse.json(deprecated, { status: 410 });\n}',
      },
      {
        path: "app/api/stripe/checkout/route.ts",
        content:
          '// Stripe checkout not yet implemented\nexport async function POST() {\n  return NextResponse.json({ error: "Stripe payments not yet implemented" }, { status: 501 });\n}',
      },
      {
        path: "app/auth/callback/route.ts",
        content: 'export async function GET() {\n  await supabase.auth.exchangeCodeForSession(code);\n}',
      },
      {
        path: "app/api/unprotected/route.ts",
        content: "export async function POST() {\n  return Response.json({ ok: true });\n}",
      },
    ]);
    const authMissing = result.findings.filter((finding) => finding.ruleId === "auth.missing");
    expect(authMissing).toHaveLength(1);
    expect(authMissing[0]?.location.path).toBe("app/api/unprotected/route.ts");
  });

  it("does not flag webhook signature routes or GET-only handlers for authz/validation noise", async () => {
    const result = await scanRepository([
      {
        path: "app/api/webhooks/github/route.ts",
        content:
          'import { verifyGitHubWebhookSignature } from "@/server/github-automation/webhook-utils";\nexport async function POST(request) {\n  if (!verifyGitHubWebhookSignature(rawBody, signature, secret)) return Response.json({ error: "Invalid signature" }, { status: 401 });\n}',
      },
      {
        path: "app/api/brain/organization/route.ts",
        content:
          'import { getServerAuthContext } from "@/lib/auth/dev-bypass";\nexport async function GET() {\n  const auth = await getServerAuthContext();\n  if (!auth?.organizationId) return Response.json({ error: "No organization" }, { status: 404 });\n}',
      },
      {
        path: "app/api/repositories/[repositoryId]/scans/route.ts",
        content:
          'import { getScanRequestContext } from "@/server/security-scanner/request-context";\nexport async function POST() {\n  await getScanRequestContext("id", true);\n}',
      },
    ]);
    const authz = result.findings.filter((finding) => finding.ruleId === "authz.insufficient");
    const validation = result.findings.filter((finding) => finding.ruleId === "validation.missing");
    expect(authz).toHaveLength(0);
    expect(validation.map((finding) => finding.location.path)).toEqual([
      "app/api/repositories/[repositoryId]/scans/route.ts",
    ]);
  });

  it("does not flag deprecated routes or routes with enforceRateLimit for rate limiting", async () => {
    const result = await scanRepository([
      {
        path: "app/api/scans/route.ts",
        content:
          'const deprecated = { error: "deprecated" };\nexport async function POST() {\n  return NextResponse.json(deprecated, { status: 410 });\n}',
      },
      {
        path: "app/api/projects/route.ts",
        content:
          'import { enforceRateLimit } from "@/server/http/rate-limit";\nexport async function GET(request) {\n  const rateLimited = await enforceRateLimit(request);\n}',
      },
    ]);
    const rateLimitMissing = result.findings.filter((finding) => finding.ruleId === "rate-limit.missing");
    expect(rateLimitMissing).toHaveLength(0);
  });

  it("reports capability catalog entries without CVE claims", async () => {
    const result = await scanRepository([
      { path: "package.json", content: '{"dependencies":{"vm2":"1.0.0","other":"git+https://example.invalid/repo.git"}}' },
    ]);
    const dependencyFindings = result.findings.filter((finding) => finding.ruleId === "dependencies.local-catalog");
    expect(dependencyFindings).toHaveLength(2);
    expect(dependencyFindings.every((finding) => finding.metadata?.claimsCve === false)).toBe(true);
    expect(dependencyFindings.some((finding) => /CVE/i.test(finding.description))).toBe(false);
  });
});

describe("rule isolation", () => {
  it("continues after a rule throws", async () => {
    const broken: ScanRule = { id: "a.broken", title: "broken", run: () => { throw new Error("failure"); } };
    const healthy: ScanRule = {
      id: "b.healthy", title: "healthy",
      run: () => [{
        ruleId: "b.healthy", title: "Found", description: "Found", severity: "low", confidence: "high",
        category: "test", location: { path: "a.ts", line: 1 }, remediation: "Fix",
      }],
    };
    const result = await scanRepository([{ path: "a.ts", content: "x" }], {
      registry: new RuleRegistry([broken, healthy]),
    });
    expect(result.findings).toHaveLength(1);
    expect(result.metrics.ruleFailures).toBe(1);
    expect(result.omissions).toContainEqual(expect.objectContaining({ reason: "rule-error", ruleId: "a.broken" }));
  });
});
