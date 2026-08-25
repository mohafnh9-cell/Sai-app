import type { StaticFindingInput } from "../correlate-findings";
import { E2E_SCAN_ID } from "./e2e-harness";

export type AdapterE2EFixture = {
  adapterId: string;
  staticFinding: StaticFindingInput;
  vulnerableLabEnv?: Record<string, string>;
  protectedLabEnv?: Record<string, string>;
  vulnerableFixtureEnv?: Record<string, string>;
  protectedFixtureEnv?: Record<string, string>;
};

const now = () => new Date().toISOString();

function baseFinding(
  id: string,
  input: Omit<StaticFindingInput, "id">
): StaticFindingInput {
  return { id, ...input };
}

export const ADAPTER_E2E_FIXTURES: Record<string, AdapterE2EFixture> = {
  "webhook-signature-bypass": {
    adapterId: "webhook-signature-bypass",
    staticFinding: baseFinding("finding-webhook-1", {
      ruleId: "web.webhook",
      title: "Possible webhook signature validation weakness",
      description: "Webhook handler may accept unsigned or tampered payloads.",
      severity: "high",
      category: "web",
      filePath: "app/api/webhook/route.ts",
      recommendation: "Verify webhook HMAC signatures before processing.",
      confidence: "high",
      evidence: "No constant-time signature comparison visible.",
    }),
    vulnerableLabEnv: { SEQURAI_LAB_WEBHOOK_UNPROTECTED: "1" },
    protectedLabEnv: {},
    vulnerableFixtureEnv: { SEQURAI_DYNAMIC_LAB_WEBHOOK_PATH: "/api/webhook" },
    protectedFixtureEnv: { SEQURAI_DYNAMIC_LAB_WEBHOOK_PATH: "/api/webhook" },
  },
  "idempotency-replay": {
    adapterId: "idempotency-replay",
    staticFinding: baseFinding("finding-idempotency-1", {
      ruleId: "reliability.idempotency",
      title: "Possible idempotency replay issue",
      description: "Duplicate submissions may produce repeated side effects.",
      severity: "high",
      category: "reliability",
      filePath: "app/api/checkout/route.ts",
      recommendation: "Persist idempotency keys and return cached results on replay.",
      confidence: "high",
      evidence: "No idempotency guard on mutating endpoint.",
    }),
    vulnerableFixtureEnv: { SEQURAI_DYNAMIC_LAB_IDEMPOTENCY_PATH: "/api/idempotent-vulnerable" },
    protectedLabEnv: {},
    protectedFixtureEnv: { SEQURAI_DYNAMIC_LAB_IDEMPOTENCY_PATH: "/api/idempotent" },
  },
  "mass-assignment-probe": {
    adapterId: "mass-assignment-probe",
    staticFinding: baseFinding("finding-mass-assignment-1", {
      ruleId: "api.mass-assignment",
      title: "Possible mass assignment vulnerability",
      description: "Request body may allow privileged field modification.",
      severity: "high",
      category: "validation",
      filePath: "app/api/users/route.ts",
      recommendation: "Allowlist writable fields on user update endpoints.",
      confidence: "high",
      evidence: "role field may be writable from client input.",
    }),
    vulnerableLabEnv: {},
    protectedLabEnv: { SEQURAI_LAB_MASS_ASSIGNMENT_PROTECTED: "1" },
  },
  "privilege-escalation": {
    adapterId: "privilege-escalation",
    staticFinding: baseFinding("finding-privilege-1", {
      ruleId: "auth.admin-route",
      title: "Possible privilege escalation on admin route",
      description: "Standard user may reach admin-only functionality.",
      severity: "high",
      category: "authorization",
      filePath: "app/api/admin/stats/route.ts",
      recommendation: "Enforce admin role checks server-side.",
      confidence: "high",
      evidence: "Admin route lacks visible role guard.",
    }),
    vulnerableLabEnv: { SEQURAI_LAB_PRIVILEGE_ESCALATION_VULNERABLE: "1" },
    protectedLabEnv: {},
  },
  "security-headers-probe": {
    adapterId: "security-headers-probe",
    staticFinding: baseFinding("finding-headers-1", {
      ruleId: "web.csrf-missing",
      title: "Missing or weak security headers",
      description: "Response may lack Content-Security-Policy or HSTS.",
      severity: "medium",
      category: "web",
      filePath: "app/layout.tsx",
      recommendation: "Add CSP, HSTS, and X-Content-Type-Options headers.",
      confidence: "high",
      evidence: "No security headers configured on root response.",
    }),
    vulnerableLabEnv: {},
    protectedFixtureEnv: {
      SEQURAI_DYNAMIC_LAB_SECURITY_HEADERS_PATH: "/secure-headers",
    },
  },
  "injection-probe-safe": {
    adapterId: "injection-probe-safe",
    staticFinding: baseFinding("finding-injection-1", {
      ruleId: "injection.sql",
      title: "Possible unsafe input handling",
      description: "User input may be reflected without sanitization.",
      severity: "high",
      category: "injection",
      filePath: "app/api/echo/route.ts",
      recommendation: "Sanitize and encode user-controlled output.",
      confidence: "high",
      evidence: "Query parameter echoed in response body.",
    }),
    vulnerableLabEnv: {},
    protectedLabEnv: { SEQURAI_LAB_INJECTION_PROTECTED: "1" },
  },
  "ssrf-probe-safe": {
    adapterId: "ssrf-probe-safe",
    staticFinding: baseFinding("finding-ssrf-1", {
      ruleId: "injection.ssrf",
      title: "Possible SSRF vulnerability",
      description: "Server may fetch user-supplied URLs.",
      severity: "high",
      category: "injection",
      filePath: "app/api/outbound-fetch/route.ts",
      recommendation: "Block internal and metadata URLs from outbound fetch.",
      confidence: "high",
      evidence: "URL parameter passed to outbound fetch helper.",
    }),
    vulnerableLabEnv: { SEQURAI_LAB_SSRF_VULNERABLE: "1" },
    protectedLabEnv: {},
  },
  "cors-misconfiguration": {
    adapterId: "cors-misconfiguration",
    staticFinding: baseFinding("finding-cors-1", {
      ruleId: "web.permissive-cors",
      title: "Possible CORS misconfiguration",
      description: "Cross-origin policy may allow untrusted origins with credentials.",
      severity: "high",
      category: "web",
      filePath: "app/api/cors-test/route.ts",
      recommendation: "Restrict Access-Control-Allow-Origin to trusted origins.",
      confidence: "high",
      evidence: "Wildcard CORS with credentials enabled.",
    }),
    vulnerableLabEnv: {},
    protectedLabEnv: { SEQURAI_LAB_CORS_PROTECTED: "1" },
  },
};

export function scanFindingRow(finding: StaticFindingInput) {
  return {
    id: finding.id,
    scan_id: E2E_SCAN_ID,
    rule_id: finding.ruleId ?? null,
    title: finding.title,
    description: finding.description ?? null,
    severity: finding.severity,
    category: finding.category ?? null,
    file_path: finding.filePath ?? null,
    recommendation: finding.recommendation ?? null,
    confidence: finding.confidence ?? null,
    evidence: finding.evidence ?? null,
    created_at: now(),
  };
}
