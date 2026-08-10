import { AUDIT_CORRELATION_RULES, staticFindingMatchesRule } from "./correlation-rules";
import type { StaticFindingInput } from "./correlate-findings";

/** Direct static rule → attack adapter mapping for finding-driven campaigns. */
export const STATIC_RULE_TO_ADAPTERS: Readonly<Record<string, readonly string[]>> = {
  "authz.insufficient": ["idor-cross-tenant", "privilege-escalation"],
  "auth.missing": ["unauthenticated-endpoint"],
  "auth.admin-route": ["privilege-escalation", "unauthenticated-endpoint"],
  "auth.oauth-insecure": ["unauthenticated-endpoint"],
  "auth.session-client-storage": ["unauthenticated-endpoint"],
  "auth.password-reset-exposed": ["rate-limit-brute-force"],
  "frontend.client-authz": ["privilege-escalation", "idor-cross-tenant"],
  "api.mass-assignment": ["mass-assignment-probe"],
  "validation.missing": ["mass-assignment-probe"],
  "validation.client-only-risk": ["mass-assignment-probe"],
  "rate-limit.missing": ["rate-limit-brute-force"],
  "rate-limit.auth-missing": ["rate-limit-brute-force"],
  "rate-limit.admin-missing": ["rate-limit-brute-force"],
  "injection.sql": ["injection-probe-safe"],
  "injection.command": ["injection-probe-safe"],
  "injection.path-traversal": ["injection-probe-safe"],
  "injection.ssrf": ["ssrf-probe-safe"],
  "injection.deserialization": ["injection-probe-safe"],
  "web.next-xss": ["injection-probe-safe"],
  "web.permissive-cors": ["cors-misconfiguration"],
  "web.webhook": ["webhook-signature-bypass"],
  "reliability.idempotency": ["idempotency-replay"],
  "web.csrf-missing": ["security-headers-probe"],
  "database.unsafe-raw-query": ["injection-probe-safe"],
  "supabase.rls": ["idor-cross-tenant"],
  "supabase.rls-missing": ["idor-cross-tenant"],
  "database.rls-assessment": ["idor-cross-tenant"],
};

const BASELINE_ADAPTER_IDS = [
  "idor-cross-tenant",
  "unauthenticated-endpoint",
  "rate-limit-brute-force",
  "security-headers-probe",
] as const;

function adaptersFromCorrelationRules(finding: StaticFindingInput): string[] {
  const adapters: string[] = [];
  for (const rule of AUDIT_CORRELATION_RULES) {
    if (!staticFindingMatchesRule(finding, rule)) continue;
    adapters.push(...rule.adapterIds);
  }
  return adapters;
}

export function selectAttacksFromFindings(input: {
  staticFindings: StaticFindingInput[];
  fallbackAdapterIds?: readonly string[];
  maxAdapters?: number;
}): string[] {
  const selected = new Set<string>();
  const maxAdapters = input.maxAdapters ?? 12;

  for (const finding of input.staticFindings) {
    const ruleId = (finding.ruleId ?? "").toLowerCase();
    const direct = STATIC_RULE_TO_ADAPTERS[ruleId] ?? [];
    for (const adapterId of direct) selected.add(adapterId);
    for (const adapterId of adaptersFromCorrelationRules(finding)) selected.add(adapterId);
  }

  if (selected.size === 0) {
    for (const adapterId of input.fallbackAdapterIds ?? BASELINE_ADAPTER_IDS) {
      selected.add(adapterId);
    }
  } else {
    for (const adapterId of BASELINE_ADAPTER_IDS) {
      if (selected.size >= maxAdapters) break;
      selected.add(adapterId);
    }
  }

  return [...selected].slice(0, maxAdapters);
}
