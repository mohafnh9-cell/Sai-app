import { describe, expect, it } from "vitest";
import { scanRepository } from "../index";

/**
 * Regression fixtures for the false positives found by running the AI Red
 * Team's full_product_audit against sequrai-app's own production deployment
 * (see docs/10K_READINESS_CHECKLIST.md). Each fixture is a minimal
 * reproduction of a real file in this repo that a static rule wrongly
 * flagged. If any of these start failing, a rule regressed the exclusion —
 * catch it here, not by re-running a live Red Team audit.
 */
describe("known-safe route patterns (Red Team false-positive regressions)", () => {
  it("does not flag a webhook route that verifies a signature", async () => {
    const result = await scanRepository([
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
    ]);
    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds).not.toContain("auth.missing");
    expect(ruleIds).not.toContain("authz.insufficient");
  });

  it("does not flag a route protected by a named API-key/access-check helper", async () => {
    const result = await scanRepository([
      {
        path: "app/api/projects/[id]/ci/scan/route.ts",
        content: `
          export async function POST(request: Request, { params }) {
            const accessResult = await requireCiProjectAccess(request, params.id);
            if (!accessResult.ok) return accessResult.response;
            return NextResponse.json({ ok: true });
          }
        `,
      },
    ]);
    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds).not.toContain("auth.missing");
  });

  it("does not flag RFC-mandated public OAuth endpoints for missing auth or CSRF", async () => {
    const result = await scanRepository([
      {
        path: "app/oauth/register/route.ts",
        content: `
          export async function POST(request: Request) {
            const client = await registerOAuthClient(body);
            return NextResponse.json({ client_id: client.client_id }, { status: 201 });
          }
        `,
      },
      {
        path: "app/oauth/revoke/route.ts",
        content: `
          export async function POST(request: Request) {
            await revokeOAuthToken({ token });
            return new NextResponse(null, { status: 200 });
          }
        `,
      },
      {
        path: "app/oauth/token/route.ts",
        content: `
          export async function POST(request: Request) {
            const codeVerifier = body.code_verifier?.trim();
            const tokens = await issueTokenPair({ codeVerifier });
            return NextResponse.json(tokens);
          }
        `,
      },
    ]);
    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds).not.toContain("auth.missing");
    expect(ruleIds).not.toContain("web.csrf-missing");
  });

  it("does not flag public well-known discovery metadata for missing auth", async () => {
    const result = await scanRepository([
      {
        path: "app/.well-known/oauth-protected-resource/route.ts",
        content: `
          export async function GET() {
            return NextResponse.json(buildProtectedResourceMetadata());
          }
        `,
      },
    ]);
    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds).not.toContain("auth.missing");
  });

  it("still flags a genuinely unprotected mutating route (exclusions are not a blanket pass)", async () => {
    const result = await scanRepository([
      {
        path: "app/api/widgets/route.ts",
        content: `
          export async function POST(request: Request) {
            const body = await request.json();
            await db.widgets.insert(body);
            return NextResponse.json({ ok: true });
          }
        `,
      },
    ]);
    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain("auth.missing");
  });

  it("still flags a session-based OAuth route (authorize) for CSRF", async () => {
    const result = await scanRepository([
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
    ]);
    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain("web.csrf-missing");
  });
});

/**
 * Detection Accuracy Hardening V1: web.next-xss's DOMPurify/sanitize
 * exclusion sat after a greedy, backtrackable `\s*`, so with the
 * idiomatic single space before a sanitizer call (`__html: DOMPurify.sanitize(x)`)
 * the regex engine could backtrack that `\s*` to zero width and test the
 * lookahead against " DOMPurify" (a leading space), which trivially
 * doesn't start with "DOMPurify"/"sanitize" -- defeating the exclusion
 * entirely and flagging properly-sanitized code. Fixed by absorbing the
 * whitespace inside the lookahead itself for both pattern specs
 * (dangerouslySetInnerHTML and .innerHTML =).
 */
describe("web.next-xss DOMPurify/sanitize false-positive fix (Detection Accuracy Hardening V1)", () => {
  it("does not flag dangerouslySetInnerHTML sanitized with DOMPurify.sanitize (one space after the colon)", async () => {
    const result = await scanRepository([
      { path: "components/Preview.tsx", content: "return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userHtml) }} />" },
    ]);
    expect(result.findings.map((f) => f.ruleId)).not.toContain("web.next-xss");
  });

  it("does not flag .innerHTML assignment sanitized with DOMPurify.sanitize (one space after '=')", async () => {
    const result = await scanRepository([{ path: "server/render.ts", content: "el.innerHTML = DOMPurify.sanitize(userHtml);" }]);
    expect(result.findings.map((f) => f.ruleId)).not.toContain("web.next-xss");
  });

  it("still flags unsanitized dangerouslySetInnerHTML", async () => {
    const result = await scanRepository([
      { path: "components/Preview.tsx", content: "return <div dangerouslySetInnerHTML={{ __html: userHtml }} />" },
    ]);
    expect(result.findings.map((f) => f.ruleId)).toContain("web.next-xss");
  });

  it("still flags unsanitized .innerHTML assignment", async () => {
    const result = await scanRepository([{ path: "server/render.ts", content: "el.innerHTML = userHtml;" }]);
    expect(result.findings.map((f) => f.ruleId)).toContain("web.next-xss");
  });

  it("edge case: a function that merely LOOKS like a sanitizer is still flagged (the fix does not overreach)", async () => {
    const result = await scanRepository([
      { path: "components/Preview.tsx", content: "return <div dangerouslySetInnerHTML={{ __html: maybeSanitize(userHtml) }} />" },
    ]);
    expect(result.findings.map((f) => f.ruleId)).toContain("web.next-xss");
  });
});
