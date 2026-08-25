import { CLIENT_ENV_PREFIX_PATTERN, SECRET_NAME_PATTERN } from "../constants";
import { patternFindings, type PatternSpec } from "./helpers";
import {
  classifySecretDetection,
  confidenceForSecretClassification,
  REAL_CREDENTIAL_PATTERNS,
  SECRET_CLASSIFICATION_METADATA_KEY,
  severityForSecretClassification,
} from "./secret-classification";
import type { ScanRule } from "./types";
import type { FindingDraft, NormalizedFile } from "../types";
import {
  firstServiceRoleReferenceLine,
  isSupabaseServiceRoleClientExposure,
} from "./client-exposure";
import {
  MACHINE_ENDPOINT_PATH,
  RECOGNIZED_AUTH_PATTERN,
  RECOGNIZED_AUTHZ_PATTERN,
} from "./known-safe-patterns";

const TEST_OR_EXAMPLE = /(?:^|\/)(?:test|tests|__tests__|fixtures?|examples?)(?:\/|$)|\.(?:test|spec)\./i;
const ROUTE_PATH = /(?:^|\/)(?:api|routes?|controllers?|handlers?)(?:\/|$)|route\.[jt]s$/i;
const CODE_PATH = /\.(?:[cm]?[jt]sx?|py|rb|go|java|php)$/i;
const MOCK_OR_TEST_PATH = new RegExp(
  `${TEST_OR_EXAMPLE.source}|(?:^|\\/)mock-|mock-api-runtime`,
  "i"
);

export function patternRule(id: string, title: string, specs: PatternSpec[]): ScanRule {
  return { id, title, run: ({ files }) => patternFindings(id, files, specs) };
}

const EXAMPLE_ENV_FILE = /(?:^|\/)\.env\.(?:example|sample)(?:\.|$)/i;
const README_FILE = /(?:^|\/)README(?:\.md)?$/i;

const PLACEHOLDER_VALUE =
  /(?:example|sample|placeholder|your[_-]|change[_-]?me|xxx|test[_-]?key|process\.env|\$\{|generate-a|long-random|seq_live_\.\.\.|\.\.\.|not-a-real|replace-me|insert[-_]|fake[-_]|dummy)/i;

function buildSecretFinding(input: {
  file: NormalizedFile;
  lineIndex: number;
  value: string;
  variableName?: string;
  evidence: string;
  fingerprintMaterial: string;
  patternSeverity?: "critical" | "high";
}): FindingDraft {
  const classification = classifySecretDetection({
    path: input.file.path,
    value: input.value,
    variableName: input.variableName,
    line: input.file.lines[input.lineIndex],
    lineIndex: input.lineIndex,
    fileLines: input.file.lines,
  });

  const severity =
    input.patternSeverity ??
    (classification.classification === "REAL_SECRET" && /PRIVATE KEY/.test(input.value)
      ? "critical"
      : severityForSecretClassification(classification.classification));

  const confidence = confidenceForSecretClassification(
    classification.classification,
    classification.confidence
  );

  return {
    ruleId: "secrets.exposed",
    title: "Hard-coded secret",
    description:
      classification.classification === "TEST_FIXTURE"
        ? "A test-like credential value appears in source code."
        : classification.classification === "PLACEHOLDER"
          ? "A placeholder credential-like value appears in source code."
          : "A credential-like value is committed in source.",
    severity,
    confidence,
    category: "secrets",
    location: { path: input.file.path, line: input.lineIndex + 1 },
    evidence: input.evidence,
    remediation:
      classification.classification === "TEST_FIXTURE" || classification.classification === "PLACEHOLDER"
        ? "Confirm this is only a test fixture or placeholder and not a real credential."
        : "Revoke the credential, remove it from history, and load it from a secret manager.",
    fingerprintMaterial: input.fingerprintMaterial,
    metadata: {
      [SECRET_CLASSIFICATION_METADATA_KEY]: classification.classification,
      secretClassificationSignals: classification.signals,
    },
  };
}

const exposedSecrets: ScanRule = {
  id: "secrets.exposed",
  title: "Exposed secrets",
  run: ({ files }) => {
    const findings: FindingDraft[] = [];
    for (const file of files) {
      if (EXAMPLE_ENV_FILE.test(file.path) || README_FILE.test(file.path)) continue;

      for (let i = 0; i < file.lines.length; i += 1) {
        const line = file.lines[i];
        const token = REAL_CREDENTIAL_PATTERNS.map((pattern) => line.match(pattern)).find(Boolean);
        if (token) {
          if (PLACEHOLDER_VALUE.test(token[0])) continue;
          findings.push(
            buildSecretFinding({
              file,
              lineIndex: i,
              value: token[0],
              evidence: "credential=[REDACTED]",
              fingerprintMaterial: token[0].slice(0, 8),
              patternSeverity:
                token[0].startsWith("sk_live_") || /PRIVATE KEY/.test(token[0]) ? "critical" : "high",
            })
          );
          continue;
        }

        const quotedAssignment = line.match(
          /^\s*(?:(?:export\s+)?(?:const|let|var)\s+)?["']?([A-Z0-9_-]{3,})["']?\s*[:=]\s*["']([^"']{8,})["']/i,
        );
        const envAssignment = line.match(/^\s*([A-Z0-9_]{3,})\s*=\s*(\S+)/);
        const assignment = quotedAssignment ?? envAssignment;
        if (!assignment || !SECRET_NAME_PATTERN.test(assignment[1])) continue;

        if (
          quotedAssignment &&
          !/^\s*(?:export\s+)?(?:const|let|var)\s+/i.test(line) &&
          /^\s*[A-Za-z_][\w]*\s*:\s/.test(line)
        ) {
          continue;
        }

        const value = assignment[2];
        const classification = classifySecretDetection({
          path: file.path,
          value,
          variableName: assignment[1],
          line,
          lineIndex: i,
          fileLines: file.lines,
        });
        if (classification.classification === "FALSE_POSITIVE") continue;

        findings.push(
          buildSecretFinding({
            file,
            lineIndex: i,
            value,
            variableName: assignment[1],
            evidence: `${assignment[1]}=[REDACTED]`,
            fingerprintMaterial: assignment[1],
          })
        );
      }
    }
    return findings;
  },
};

const publicEnvSecrets: ScanRule = {
  id: "secrets.public-env",
  title: "Secrets exposed to clients",
  run: ({ files }) => {
    const findings: FindingDraft[] = [];
    for (const file of files) {
      for (let i = 0; i < file.lines.length; i += 1) {
        const match = file.lines[i].match(/\b((?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_)[A-Z0-9_]+)\b\s*[:=]/);
        if (!match || !CLIENT_ENV_PREFIX_PATTERN.test(match[1]) || !SECRET_NAME_PATTERN.test(match[1])) continue;
        findings.push({
          ruleId: "secrets.public-env",
          title: "Secret uses a public environment prefix",
          description: "Client-prefixed environment variables are bundled into browser code.",
          severity: "high",
          confidence: "high",
          category: "secrets",
          location: { path: file.path, line: i + 1 },
          evidence: `${match[1]}=[REDACTED]`,
          remediation: "Keep the credential server-only and expose a narrowly scoped server endpoint.",
          fingerprintMaterial: match[1],
        });
      }
    }
    return findings;
  },
};

const serviceRoleInClient: ScanRule = {
  id: "supabase.service-role-client",
  title: "Supabase service role exposed to client code",
  run: ({ files }) =>
    files
      .filter(isSupabaseServiceRoleClientExposure)
      .map((file) => ({
        ruleId: "supabase.service-role-client",
        title: "Supabase service role referenced in client code",
        description: "A service-role credential bypasses RLS and must never be bundled for browsers.",
        severity: "critical" as const,
        confidence: "high" as const,
        category: "secrets",
        location: {
          path: file.path,
          line: firstServiceRoleReferenceLine(file),
        },
        evidence: "SUPABASE_SERVICE_ROLE_KEY=[REDACTED]",
        remediation:
          "Remove the service-role key from client code, rotate it, and use it only in a protected server environment.",
        fingerprintMaterial: "supabase-service-role-client",
      })),
};

const injectionRules = [
  patternRule("injection.sql", "SQL injection", [{
    pattern: /\b(?:query|execute|raw)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+|f["'][^"']*\{)/i,
    title: "Dynamic SQL query construction", description: "Untrusted data may be interpolated into SQL.",
    severity: "high", confidence: "medium", category: "injection",
    remediation: "Use parameterized queries or the ORM query builder.", path: CODE_PATH,
  }]),
  patternRule("injection.command", "Command injection", [{
    pattern: /\b(?:exec|execSync|system|popen|shell_exec)\s*\(\s*(?:`[^`]*\$\{|[^)]*(?:req\.|request\.|params|query|body))/i,
    title: "User-controlled command execution", description: "Input may be incorporated into an operating-system command.",
    severity: "critical", confidence: "medium", category: "injection",
    remediation: "Avoid shell execution; use an argument-array API and strict allowlists.", path: CODE_PATH,
  }, {
    pattern: /\bspawn(?:Sync)?\s*\([^)]*(?:req\.|request\.|params|query|body)[\s\S]{0,160}shell\s*:\s*true/i,
    title: "User-controlled command executed through a shell", description: "A dynamic spawn call enables shell interpretation.",
    severity: "critical", confidence: "high", category: "injection",
    remediation: "Disable shell mode and pass validated arguments as a fixed array.", path: CODE_PATH,
  }]),
  patternRule("injection.path-traversal", "Path traversal", [{
    pattern: /\b(?:readFile|readFileSync|writeFile|createReadStream|sendFile|open)\s*\([^)]*(?:req\.|request\.|params|query|body)/i,
    title: "User-controlled filesystem path", description: "A request value appears to flow into a filesystem operation.",
    severity: "high", confidence: "medium", category: "injection",
    remediation: "Resolve against a fixed base directory and reject paths that escape it.", path: CODE_PATH,
  }]),
];

const configurationRules = [
  patternRule("web.permissive-cors", "Permissive CORS", [{
    pattern: /(?:Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*|cors\s*\(\s*(?:\)|\{[^}]*origin\s*:\s*(?:true|["']\*)))/i,
    title: "Permissive cross-origin policy", description: "The application allows requests from any origin.",
    severity: "medium", confidence: "high", category: "configuration",
    remediation: "Allow only explicitly trusted origins and avoid credentialed wildcard policies.", path: CODE_PATH, excludePath: MOCK_OR_TEST_PATH,
  }, {
    pattern: /origin\s*:\s*\([^)]*\)\s*=>\s*(?:true|callback\s*\(\s*null\s*,\s*true)/i,
    title: "CORS origin reflected without an allowlist", description: "The origin callback appears to approve every requesting origin.",
    severity: "high", confidence: "high", category: "configuration",
    remediation: "Compare the origin against an explicit allowlist before approving it.", path: CODE_PATH, excludePath: MOCK_OR_TEST_PATH,
  }]),
  patternRule("auth.insecure-cookie", "Insecure cookies", [{
    pattern: /\.cookie\s*\([^)]*,[^)]*,\s*\{(?:(?!secure\s*:\s*true).)*\}/i,
    title: "Cookie lacks explicit secure attributes", description: "A cookie is created without an explicit secure flag.",
    severity: "medium", confidence: "medium", category: "authentication",
    remediation: "Set Secure, HttpOnly, and an appropriate SameSite policy.", path: CODE_PATH, excludePath: TEST_OR_EXAMPLE,
  }, {
    pattern: /(?:httpOnly|secure)\s*:\s*false/i,
    title: "Cookie security disabled", description: "A cookie security attribute is explicitly disabled.",
    severity: "high", confidence: "high", category: "authentication",
    remediation: "Enable Secure and HttpOnly for session cookies.", path: CODE_PATH, excludePath: TEST_OR_EXAMPLE,
  }, {
    pattern: /(?:cookies?\.set|setCookie)\s*\([^)]*,\s*\{(?:(?!httpOnly\s*:\s*true|sameSite\s*:).)*\}/i,
    title: "Session cookie lacks explicit browser protections", description: "A cookie configuration omits HttpOnly or SameSite protection.",
    severity: "medium", confidence: "medium", category: "authentication",
    remediation: "Set HttpOnly, Secure in production, SameSite, and a reasonable expiration.", path: CODE_PATH, excludePath: TEST_OR_EXAMPLE,
  }]),
  patternRule("auth.insecure-jwt", "Insecure JWT", [{
    pattern: /(?:algorithm|algorithms)\s*:\s*(?:["']none["']|\[\s*["']none["']\s*\])/i,
    title: "JWT accepts the none algorithm", description: "Unsigned JWTs may be accepted.",
    severity: "critical", confidence: "high", category: "authentication",
    remediation: "Require a specific asymmetric or HMAC algorithm and validate issuer and audience.", path: CODE_PATH, excludePath: TEST_OR_EXAMPLE,
  }, {
    pattern: /jwt\.decode\s*\(/i,
    title: "JWT decoded without visible verification", description: "Decoding alone does not verify a JWT signature.",
    severity: "high", confidence: "medium", category: "authentication",
    remediation: "Verify the token signature, algorithm, issuer, audience, and expiration.", path: CODE_PATH, excludePath: TEST_OR_EXAMPLE,
  }, {
    pattern: /jwt\.sign\s*\([^;\n]+(?:\)|\})\s*;?$/im,
    title: "JWT may be issued without explicit expiration", description: "A JWT signing call has no visible expiresIn option.",
    severity: "medium", confidence: "low", category: "authentication",
    remediation: "Set a short explicit expiration and validate issuer and audience when verifying.", path: CODE_PATH, excludePath: TEST_OR_EXAMPLE,
  }]),
  patternRule("privacy.sensitive-logging", "Sensitive logging and debug", [{
    pattern: /console\.(?:log|debug|info)\s*\([^)]*(?:password|secret|token|authorization|cookie|req\.body)/i,
    title: "Sensitive value may be logged", description: "Logs may expose credentials or request secrets.",
    severity: "medium", confidence: "medium", category: "privacy",
    remediation: "Remove the log or apply structured allowlist-based redaction.", path: CODE_PATH, excludePath: TEST_OR_EXAMPLE,
  }, {
    pattern: /\bdebug\s*[:=]\s*true\b/i,
    title: "Debug mode enabled", description: "Debug output can disclose implementation details.",
    severity: "low", confidence: "medium", category: "configuration",
    remediation: "Disable debug mode in production configuration.", excludePath: TEST_OR_EXAMPLE,
  }]),
  patternRule("web.open-redirect", "Open redirect", [{
    pattern: /(?:redirect|location(?:\.href)?\s*=)\s*\([^)]*(?:req\.|request\.|params|query|searchParams)/i,
    title: "User-controlled redirect", description: "A request value appears to determine the redirect destination.",
    severity: "medium", confidence: "medium", category: "web",
    remediation: "Allowlist local paths or trusted destination hosts.", path: CODE_PATH,
  }]),
  patternRule("web.next-xss", "Next.js and XSS", [{
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!DOMPurify|sanitize)/,
    title: "Unsanitized HTML rendering", description: "React HTML injection can execute attacker-controlled markup.",
    severity: "high", confidence: "medium", category: "xss",
    remediation: "Avoid raw HTML or sanitize it with a maintained allowlist sanitizer.", path: /\.(?:jsx|tsx)$/,
  }, {
    pattern: /\.innerHTML\s*=\s*(?!DOMPurify|sanitize|trustedTypes)/,
    title: "Unsanitized innerHTML assignment", description: "Direct HTML assignment may execute attacker-controlled markup.",
    severity: "high", confidence: "medium", category: "xss",
    remediation: "Render text safely or sanitize markup with a maintained allowlist sanitizer.", path: CODE_PATH,
  }, {
    pattern: /\bNextResponse\.next\s*\(\s*\{\s*request\s*:\s*\{\s*headers/i,
    title: "Request headers forwarded broadly", description: "Forwarding an unrestricted header set can leak or trust spoofable values.",
    severity: "low", confidence: "low", category: "configuration",
    remediation: "Copy only explicitly required headers.", path: /(?:middleware|proxy)\.[jt]s$/,
  }]),
];

const missingNextSecurityHeaders: ScanRule = {
  id: "next.security-headers",
  title: "Missing Next.js security headers",
  run: ({ files }) => {
    const config = files.find((file) => /^next\.config\.[cm]?[jt]s$/.test(file.path));
    if (!config || !/\bheaders\s*\(/.test(config.content)) return [];
    const missing = [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "Referrer-Policy",
    ].filter((header) => !config.content.includes(header));
    if (missing.length === 0) return [];
    return [{
      ruleId: "next.security-headers",
      title: "Next.js security headers are incomplete",
      description: `The existing headers configuration does not visibly set: ${missing.join(", ")}.`,
      severity: "low",
      confidence: "high",
      category: "configuration",
      location: { path: config.path, line: 1 },
      evidence: `Missing ${missing.join(", ")}`,
      remediation: "Add the missing headers with values appropriate for the deployed application.",
      fingerprintMaterial: missing.join(","),
    }];
  },
};

export function contextualRouteRule(
  id: string,
  title: string,
  missing: RegExp,
  finding: Omit<FindingDraft, "ruleId" | "location" | "fingerprintMaterial">,
  options?: {
    excludePath?: RegExp;
    excludeContent?: RegExp;
    includeContent?: RegExp;
  },
): ScanRule {
  return {
    id, title,
    run: ({ files }) => files
      .filter((file) => ROUTE_PATH.test(file.path) && CODE_PATH.test(file.path) && /(?:export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|\b(?:router|app)\.(?:get|post|put|patch|delete)\s*\()/i.test(file.content))
      .filter((file) => !options?.excludePath?.test(file.path))
      .filter((file) => !options?.excludeContent?.test(file.content))
      .filter((file) => !options?.includeContent || options.includeContent.test(file.content))
      .filter((file) => !missing.test(file.content))
      .map((file) => ({ ...finding, ruleId: id, location: { path: file.path, line: 1 }, fingerprintMaterial: file.path })),
  };
}

const RECOGNIZED_AUTH = RECOGNIZED_AUTH_PATTERN;
const RECOGNIZED_AUTHZ = RECOGNIZED_AUTHZ_PATTERN;
const DEPRECATED_PUBLIC_ROUTE = /const\s+deprecated\s*=[\s\S]*?status:\s*410/i;
const UNIMPLEMENTED_STUB_ROUTE = /not\s+yet\s+implemented/i;
const MUTATING_ROUTE_HANDLER = /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/i;
const ROUTE_RULE_EXCLUSIONS = {
  excludePath: MACHINE_ENDPOINT_PATH,
  excludeContent: new RegExp(
    `${DEPRECATED_PUBLIC_ROUTE.source}|${UNIMPLEMENTED_STUB_ROUTE.source}`,
    "i",
  ),
};

const routeRules: ScanRule[] = [
  contextualRouteRule("auth.missing", "Missing authentication", RECOGNIZED_AUTH, {
    title: "Route has no visible authentication", description: "A request handler was found without a recognizable authentication check.",
    severity: "medium", confidence: "low", category: "authentication",
    remediation: "Enforce authentication in the handler or a guaranteed middleware layer.",
  }, ROUTE_RULE_EXCLUSIONS),
  contextualRouteRule("authz.insufficient", "Insufficient authorization", RECOGNIZED_AUTHZ, {
    title: "Route has no visible authorization", description: "The handler has no recognizable ownership, role, or policy check.",
    severity: "medium", confidence: "low", category: "authorization",
    remediation: "Check object ownership or explicit permissions after authentication.",
  }, ROUTE_RULE_EXCLUSIONS),
  contextualRouteRule("validation.missing", "Missing validation", /(?:\.parse\(|safeParse|validate|schema|joi\.|yup\.|zod|validator)/i, {
    title: "Route has no visible input validation", description: "A mutating handler lacks a recognizable schema validation step.",
    severity: "low", confidence: "low", category: "validation",
    remediation: "Validate request inputs with an explicit schema before use.",
  }, {
    ...ROUTE_RULE_EXCLUSIONS,
    includeContent: MUTATING_ROUTE_HANDLER,
  }),
  contextualRouteRule("rate-limit.missing", "Missing rate limiting", /(?:rateLimit|ratelimit|limiter|throttl|upstash|enforceRateLimit|requireProjectApiAccess|assertInternalOpsAuthorized)/i, {
    title: "Route has no visible rate limiting", description: "No local rate-limit control was recognized; infrastructure controls may exist.",
    severity: "low", confidence: "low", category: "availability",
    remediation: "Apply per-identity and per-IP limits to abuse-sensitive endpoints.",
  }, ROUTE_RULE_EXCLUSIONS),
];

const backendRules = [
  patternRule("supabase.rls", "Supabase RLS", [{
    pattern: /ALTER\s+TABLE\s+[\w".]+\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    title: "Supabase/Postgres RLS disabled", description: "Row-level security is explicitly disabled.",
    severity: "high", confidence: "high", category: "authorization",
    remediation: "Enable RLS and define least-privilege policies.", path: /\.sql$/,
  }, {
    pattern: /CREATE\s+POLICY[\s\S]*USING\s*\(\s*true\s*\)/i,
    title: "Permissive RLS policy", description: "The policy allows every row without a user predicate.",
    severity: "high", confidence: "high", category: "authorization",
    remediation: "Restrict the policy with authenticated user or tenant predicates.", path: /\.sql$/,
  }]),
  patternRule("firebase.rules", "Firebase security", [{
    pattern: /allow\s+(?:read|write|read,\s*write)\s*:\s*if\s+true\s*;/i,
    title: "Firebase rule allows public access", description: "The rule grants unconditional access.",
    severity: "critical", confidence: "high", category: "authorization",
    remediation: "Require authenticated identity and resource-specific authorization.", path: /(?:firestore|storage)\.rules$/,
  }, {
    pattern: /signInWithEmailAndPassword\s*\([^,]+,\s*["'][^"']+["']\s*\)/i,
    title: "Hard-coded Firebase password", description: "A password is embedded in a Firebase authentication call.",
    severity: "high", confidence: "high", category: "secrets",
    remediation: "Collect credentials securely and never commit passwords.", path: CODE_PATH,
  }]),
];

const missingSensitiveRls: ScanRule = {
  id: "supabase.rls-missing",
  title: "Sensitive table without visible RLS enablement",
  run: ({ files }) => {
    const sql = files.filter((file) => file.extension === ".sql");
    const combined = sql.map((file) => file.content).join("\n");
    const findings: FindingDraft[] = [];
    const sensitive = /(?:users?|profiles?|accounts?|organizations?|projects?|payments?|customers?|sessions?|tokens?)/i;
    for (const file of sql) {
      for (let index = 0; index < file.lines.length; index += 1) {
        const match = file.lines[index].match(/create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?["']?([\w-]+)["']?/i);
        if (!match || !sensitive.test(match[1])) continue;
        const escaped = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`alter\\s+table\\s+(?:public\\.)?[\"']?${escaped}[\"']?\\s+enable\\s+row\\s+level\\s+security`, "i").test(combined)) continue;
        findings.push({
          ruleId: "supabase.rls-missing",
          title: "Sensitive table has no visible RLS enablement",
          description: `Table ${match[1]} is created without a matching ENABLE ROW LEVEL SECURITY statement in the analyzed SQL.`,
          severity: "high",
          confidence: "medium",
          category: "authorization",
          location: { path: file.path, line: index + 1 },
          evidence: `CREATE TABLE ${match[1]}`,
          remediation: "Enable RLS and add least-privilege policies before exposing the table through Supabase.",
          fingerprintMaterial: match[1],
        });
      }
    }
    return findings;
  },
};

export const BUILTIN_RULES: ScanRule[] = [
  exposedSecrets,
  publicEnvSecrets,
  serviceRoleInClient,
  ...injectionRules,
  ...configurationRules,
  missingNextSecurityHeaders,
  ...routeRules,
  ...backendRules,
  missingSensitiveRls,
];
