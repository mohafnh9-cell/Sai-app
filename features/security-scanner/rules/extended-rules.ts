import { patternFindings, type PatternSpec } from "./helpers";
import { patternRule, contextualRouteRule } from "./builtin";
import type { ScanRule } from "./types";
import type { FindingDraft } from "../types";
import { MACHINE_ENDPOINT_PATH, TEST_OR_EXAMPLE_PATH } from "./known-safe-patterns";

const TEST_OR_EXAMPLE = TEST_OR_EXAMPLE_PATH;
const ROUTE_PATH = /(?:^|\/)(?:api|routes?|controllers?|handlers?)(?:\/|$)|route\.[jt]s$/i;
const CODE_PATH = /\.(?:[cm]?[jt]sx?|py|rb|go|java|php)$/i;
const SERVER_SIDE_PATH = /(?:^|\/)(?:server\/|app\/api\/|pages\/api\/|lib\/.*(?:server|api))/i;
const MOCK_RUNTIME_PATH = /(?:^|\/)server\/ai-red-team\/|mock-api-runtime|playwright-runtime|register-default-api-specialists/i;
const AUTH_ROUTE = /(?:login|signin|signup|register|password|reset|otp|verify|auth|magic-link|forgot)/i;
const ADMIN_ROUTE = /(?:admin|internal|moderator|superuser|privileged)/i;

const RECOGNIZED_RATE_LIMIT =
  /(?:rateLimit|ratelimit|limiter|throttl|upstash|enforceRateLimit|slowDown|express-rate-limit|@upstash\/ratelimit)/i;

const injectionExtended = [
  patternRule("injection.ssrf", "Server-side request forgery", [{
    pattern: /\b(?:fetch|axios|got|request|http\.get|https\.get)\s*\(\s*(?:`[^`]*\$\{|[^)]*(?:req\.|request\.|params|query|body|searchParams))/i,
    title: "User-controlled outbound request URL",
    description: "A request value may determine the destination of a server-side HTTP call (SSRF risk).",
    severity: "high",
    confidence: "medium",
    category: "injection",
    remediation: "Allowlist outbound hosts, block private IP ranges, and never pass raw user input to fetch URLs.",
    path: SERVER_SIDE_PATH,
    excludePath: /(?:test|spec|features\/security-scanner|mock-api-runtime|playwright-runtime)/i,
  }]),
  patternRule("injection.deserialization", "Unsafe deserialization", [{
    pattern: /\b(?:unserialize\s*\(|serialize\.unserialize\s*\(|eval\s*\(|new\s+Function\s*\()/i,
    title: "Unsafe deserialization or dynamic code execution",
    description: "Untrusted data may be deserialized or executed as code.",
    severity: "critical",
    confidence: "high",
    category: "injection",
    remediation: "Use JSON with explicit schemas; never deserialize executable payloads.",
    path: CODE_PATH,
    excludePath: /(?:test|spec|features\/security-scanner|server\/ai-red-team\/teams\/browser)/i,
  }]),
];

const authExtended = [
  patternRule("auth.admin-route", "Unprotected admin route", [{
    pattern: /(?:app\/api|pages\/api|routes)[^"\n]*admin[^"\n]*(?:route|handler|GET|POST)/i,
    title: "Admin route path detected",
    description: "An admin-scoped route exists — verify server-side role checks on every handler.",
    severity: "high",
    confidence: "low",
    category: "authorization",
    remediation: "Require authenticated admin role before any admin route handler logic.",
    path: /(?:route\.[jt]s|admin)/i,
  }]),
  patternRule("auth.oauth-insecure", "Insecure OAuth configuration", [{
    pattern: /(?:oauth|OAuth)[\s\S]{0,200}(?:state\s*:\s*false|skipState|allowDangerousEmailAccountLinking\s*:\s*true)/i,
    title: "OAuth flow may skip CSRF/state protection",
    description: "OAuth configuration appears to disable state validation or allow dangerous account linking.",
    severity: "high",
    confidence: "medium",
    category: "authentication",
    remediation: "Require state parameter validation and restrict account linking policies.",
    path: CODE_PATH,
    excludePath: /(?:test|spec|features\/security-scanner)/i,
  }]),
  patternRule("auth.session-client-storage", "Session token in client storage", [{
    pattern: /localStorage\.(?:setItem|getItem)\s*\([^)]*(?:token|auth|session|jwt|access)/i,
    title: "Authentication token stored in localStorage",
    description: "Browser localStorage is readable by XSS — prefer HttpOnly cookies for session tokens.",
    severity: "high",
    confidence: "medium",
    category: "authentication",
    remediation: "Store session tokens in HttpOnly, Secure cookies instead of localStorage.",
    path: CODE_PATH,
    excludePath: TEST_OR_EXAMPLE,
  }]),
  patternRule("auth.password-reset-exposed", "Password reset flow risks", [{
    pattern: /(?:resetPassword|forgotPassword|sendPasswordReset|recoverPassword)[\s\S]{0,120}(?:console\.log|return\s+token)/i,
    title: "Password reset may leak tokens or codes",
    description: "Password reset logic may log or return reset tokens to clients.",
    severity: "high",
    confidence: "medium",
    category: "authentication",
    remediation: "Never log or return reset tokens; use single-use expiring tokens server-side only.",
    path: CODE_PATH,
  }]),
];

const apiExtended = [
  patternRule("api.mass-assignment", "Mass assignment", [{
    pattern: /(?:req\.body|request\.json|body)\s*[\s\S]{0,80}(?:role\s*[:=]|isAdmin|admin\s*[:=]|permissions\s*[:=]|organizationId\s*[:=])/i,
    title: "Privileged field may be accepted from request body",
    description: "Request body handling references privileged fields that attackers may tamper with.",
    severity: "high",
    confidence: "medium",
    category: "authorization",
    remediation: "Use explicit allowlists for writable fields; never bind role or admin flags from client input.",
    path: ROUTE_PATH,
    excludePath: MOCK_RUNTIME_PATH,
  }]),
  patternRule("api.error-leakage", "Verbose error responses", [{
    pattern: /(?:res\.(?:json|send)|NextResponse\.json)\s*\([^)]*(?:stackTrace|details:\s*error\.stack)/i,
    title: "API may return verbose error details",
    description: "Error responses may expose stack traces or internal details to clients.",
    severity: "medium",
    confidence: "medium",
    category: "api",
    remediation: "Return generic errors to clients; log details server-side only.",
    path: CODE_PATH,
    excludePath: TEST_OR_EXAMPLE,
  }]),
  patternRule("api.dangerous-method", "Dangerous HTTP method exposure", [{
    pattern: /export\s+async\s+function\s+(?:TRACE|TRACK|CONNECT)\b/i,
    title: "Uncommon HTTP method exported on route",
    description: "TRACE/TRACK/CONNECT methods can expose proxy or debugging behavior.",
    severity: "low",
    confidence: "high",
    category: "api",
    remediation: "Disable uncommon HTTP methods at the framework or edge layer.",
    path: ROUTE_PATH,
  }]),
];

const webExtended = [
  patternRule("web.csrf-missing", "Missing CSRF protection", [{
    pattern: /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)[\s\S]{0,400}(?!csrf|CSRF|csrfToken|doubleSubmit|sameSite|getServerSession|auth\(|requireAuth|getSession)/i,
    title: "Mutating route without visible CSRF protection",
    description: "State-changing handler lacks recognizable CSRF token or double-submit validation.",
    severity: "medium",
    confidence: "low",
    category: "web",
    remediation: "Validate CSRF tokens or use SameSite cookies with anti-CSRF patterns for browser clients.",
    path: /(?:^|\/)app\/(?!api\/)/i,
    excludePath: new RegExp(`${TEST_OR_EXAMPLE.source}|${MACHINE_ENDPOINT_PATH.source}`, "i"),
  }]),
  patternRule("frontend.client-authz", "Client-side authorization check", [{
    pattern: /(?:if\s*\(\s*(?:user\.role|session\.user\.role|isAdmin|permissions))[\s\S]{0,200}(?:return|null|<Redirect)/i,
    title: "Authorization enforced only in client UI",
    description: "Role or permission checks appear in UI code without guaranteed server enforcement.",
    severity: "high",
    confidence: "low",
    category: "authorization",
    remediation: "Enforce authorization on the server for every protected action; UI checks are not security boundaries.",
    path: /\.(?:jsx|tsx)$/,
  }]),
];

const databaseExtended = [
  patternRule("database.unsafe-raw-query", "Unsafe raw database query", [{
    pattern: /\$(?:queryRawUnsafe|executeRawUnsafe)\s*\(\s*(?:`[^`]*\$\{|[^)]*(?:req\.|request\.|params|query|body))/i,
    title: "Unsafe raw SQL with dynamic input",
    description: "Prisma or ORM raw query may interpolate untrusted values.",
    severity: "critical",
    confidence: "high",
    category: "database",
    remediation: "Use parameterized queries or tagged template APIs; never concatenate user input into raw SQL.",
    path: CODE_PATH,
  }]),
];

const cicdExtended = [
  patternRule("cicd.github-actions-secrets", "GitHub Actions secret exposure", [{
    pattern: /(?:secrets\.|GITHUB_TOKEN|env:\s*\n[\s\S]*(?:password|api_key|secret|token):\s*['"][^'"]+['"])/i,
    title: "Workflow may expose or mishandle secrets",
    description: "GitHub Actions workflow references secrets or hard-coded credentials in env blocks.",
    severity: "high",
    confidence: "medium",
    category: "cicd",
    remediation: "Use GitHub encrypted secrets only; never commit credentials in workflow files.",
    path: /^\.github\/workflows\/.+\.ya?ml$/i,
  }]),
  patternRule("cicd.github-actions-permissions", "GitHub Actions excessive permissions", [{
    pattern: /permissions:\s*\n[\s\S]*(?:write-all|contents:\s*write|pull-requests:\s*write)[\s\S]*pull_request_target/i,
    title: "Workflow uses pull_request_target with broad permissions",
    description: "pull_request_target with write permissions is a common supply-chain attack vector.",
    severity: "high",
    confidence: "high",
    category: "cicd",
    remediation: "Avoid pull_request_target with write permissions; use least-privilege workflow permissions.",
    path: /^\.github\/workflows\/.+\.ya?ml$/i,
  }, {
    pattern: /permissions:\s*write-all/i,
    title: "GitHub Actions workflow grants write-all permissions",
    description: "Overly broad workflow permissions increase supply-chain risk.",
    severity: "medium",
    confidence: "high",
    category: "cicd",
    remediation: "Set explicit least-privilege permissions for each workflow job.",
    path: /^\.github\/workflows\/.+\.ya?ml$/i,
  }]),
];

const validationExtended: ScanRule[] = [
  contextualRouteRule(
    "validation.client-only-risk",
    "Missing server-side validation on mutating route",
    /(?:\.parse\(|safeParse|\.safeParse|validate|schema|joi\.|yup\.|zod|valibot|validator|superRefine|parseBody|parseJsonBody|from\s+["']zod["'])/i,
    {
      title: "Mutating route lacks visible server-side validation",
      description:
        "Handler accepts mutations without recognizable schema validation — client-side validation alone is insufficient.",
      severity: "medium",
      confidence: "medium",
      category: "validation",
      remediation: "Validate all mutating inputs with a server-side schema before processing.",
    },
    {
      excludePath: /(?:\/auth\/callback\/|\/webhooks\/)/,
      includeContent: /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)[\s\S]{0,600}(?:request\.json|req\.json|req\.body|request\.body)/i,
    }
  ),
];

const rateLimitAuthRoutes: ScanRule[] = [
  {
    id: "rate-limit.auth-missing",
    title: "Missing rate limiting on authentication routes",
    run: ({ files }) =>
      files
        .filter(
          (file) =>
            ROUTE_PATH.test(file.path) &&
            AUTH_ROUTE.test(file.path) &&
            !/\/internal\//.test(file.path) &&
            /(?:export\s+async\s+function\s+(?:POST|GET)|\.(?:post|get)\s*\()/i.test(file.content)
        )
        .filter((file) => !RECOGNIZED_RATE_LIMIT.test(file.content))
        .map((file) => ({
          ruleId: "rate-limit.auth-missing",
          title: "Authentication route lacks visible rate limiting",
          description:
            "Login, signup, or password reset endpoints without recognizable throttling are vulnerable to brute-force and abuse.",
          severity: "high",
          confidence: "medium",
          category: "availability",
          location: { path: file.path, line: 1 },
          evidence: `auth-route=${file.path}`,
          remediation:
            "Apply per-IP and per-identity rate limits on authentication and password reset endpoints.",
          fingerprintMaterial: file.path,
        })),
  },
  {
    id: "rate-limit.admin-missing",
    title: "Missing rate limiting on admin routes",
    run: ({ files }) =>
      files
        .filter(
          (file) =>
            ROUTE_PATH.test(file.path) &&
            ADMIN_ROUTE.test(file.path) &&
            !/\/internal\//.test(file.path) &&
            /(?:export\s+async\s+function|router\.|app\.)/i.test(file.content)
        )
        .filter((file) => !RECOGNIZED_RATE_LIMIT.test(file.content))
        .map((file) => ({
          ruleId: "rate-limit.admin-missing",
          title: "Admin or privileged route lacks visible rate limiting",
          description: "Sensitive admin endpoints should enforce strict rate limits.",
          severity: "medium",
          confidence: "medium",
          category: "availability",
          location: { path: file.path, line: 1 },
          evidence: `admin-route=${file.path}`,
          remediation: "Add rate limiting and audit logging on admin endpoints.",
          fingerprintMaterial: file.path,
        })),
  },
];

const rlsAssessmentRule: ScanRule = {
  id: "database.rls-assessment",
  title: "Row Level Security assessment",
  run: ({ files }) => {
    const sqlFiles = files.filter((f) => f.extension === ".sql");
    if (sqlFiles.length === 0) return [];
    const combined = sqlFiles.map((f) => f.content).join("\n");
    const findings: FindingDraft[] = [];
    const tables: Array<{ name: string; path: string; line: number }> = [];

    for (const file of sqlFiles) {
      file.lines.forEach((line, index) => {
        const match = line.match(
          /create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?["']?([\w-]+)["']?/i
        );
        if (match) tables.push({ name: match[1], path: file.path, line: index + 1 });
      });
    }

    for (const table of tables) {
      const escaped = table.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const enabled = new RegExp(
        `alter\\s+table\\s+(?:public\\.)?["']?${escaped}["']?\\s+enable\\s+row\\s+level\\s+security`,
        "i"
      ).test(combined);
      const disabled = new RegExp(
        `alter\\s+table\\s+(?:public\\.)?["']?${escaped}["']?\\s+disable\\s+row\\s+level\\s+security`,
        "i"
      ).test(combined);
      const permissive = new RegExp(
        `create\\s+policy[\\s\\S]*on\\s+(?:public\\.)?["']?${escaped}["']?[\\s\\S]*using\\s*\\(\\s*true\\s*\\)`,
        "i"
      ).test(combined);

      if (disabled) {
        findings.push({
          ruleId: "database.rls-assessment",
          title: `RLS FAIL: ${table.name} has RLS disabled`,
          description: "Row Level Security is explicitly disabled on a table.",
          severity: "high",
          confidence: "high",
          category: "database",
          location: { path: table.path, line: table.line },
          evidence: `RLS=DISABLED;table=${table.name}`,
          remediation: "Enable RLS and add least-privilege policies.",
          fingerprintMaterial: `${table.name}:disabled`,
          metadata: { rlsStatus: "FAIL" },
        });
      } else if (permissive) {
        findings.push({
          ruleId: "database.rls-assessment",
          title: `RLS FAIL: permissive policy on ${table.name}`,
          description: "An RLS policy uses USING (true) allowing unrestricted access.",
          severity: "high",
          confidence: "high",
          category: "database",
          location: { path: table.path, line: table.line },
          evidence: `RLS=FAIL;policy=USING(true);table=${table.name}`,
          remediation: "Replace permissive policies with tenant/user-scoped predicates.",
          fingerprintMaterial: `${table.name}:permissive`,
          metadata: { rlsStatus: "FAIL" },
        });
      } else if (!enabled) {
        findings.push({
          ruleId: "database.rls-assessment",
          title: `RLS FAIL: ${table.name} without visible RLS enablement`,
          description: "Table created without matching ENABLE ROW LEVEL SECURITY in analyzed SQL.",
          severity: "high",
          confidence: "medium",
          category: "database",
          location: { path: table.path, line: table.line },
          evidence: `RLS=FAIL;table=${table.name}`,
          remediation: "Enable RLS before exposing the table through Supabase or Postgres APIs.",
          fingerprintMaterial: `${table.name}:missing`,
          metadata: { rlsStatus: "FAIL" },
        });
      } else {
        findings.push({
          ruleId: "database.rls-assessment",
          title: `RLS PASS: ${table.name}`,
          description: "Row Level Security appears enabled for this table.",
          severity: "info",
          confidence: "high",
          category: "database",
          location: { path: table.path, line: table.line },
          evidence: `RLS=PASS;table=${table.name}`,
          remediation: "Keep policies reviewed on each migration.",
          fingerprintMaterial: `${table.name}:pass`,
          metadata: { rlsStatus: "PASS" },
        });
      }
    }
    return findings;
  },
};

export const EXTENDED_RULES: ScanRule[] = [
  ...injectionExtended,
  ...authExtended,
  ...apiExtended,
  ...webExtended,
  ...databaseExtended,
  ...cicdExtended,
  ...validationExtended,
  ...rateLimitAuthRoutes,
  rlsAssessmentRule,
];
