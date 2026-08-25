/** Maps static scan signals to security-test adapter IDs for correlation. */
export type CorrelationRule = {
  adapterIds: readonly string[];
  staticRuleIds?: readonly string[];
  categoryKeywords?: readonly string[];
  titleKeywords?: readonly string[];
};

export const AUDIT_CORRELATION_RULES: readonly CorrelationRule[] = [
  {
    adapterIds: ["idor-cross-tenant", "privilege-escalation"],
    staticRuleIds: ["authz.insufficient", "frontend.client-authz"],
    categoryKeywords: ["authorization", "authz"],
    titleKeywords: ["authorization", "ownership", "tenant", "idor", "cross-tenant", "client-side"],
  },
  {
    adapterIds: ["unauthenticated-endpoint"],
    staticRuleIds: ["auth.missing", "auth.oauth-insecure", "auth.session-client-storage"],
    categoryKeywords: ["authentication"],
    titleKeywords: ["authentication", "unauthenticated", "no visible authentication", "oauth", "localstorage"],
  },
  {
    adapterIds: ["privilege-escalation"],
    staticRuleIds: ["auth.admin-route", "api.mass-assignment"],
    categoryKeywords: ["authorization"],
    titleKeywords: ["admin", "privilege", "mass assignment", "role"],
  },
  {
    adapterIds: ["rate-limit-brute-force"],
    staticRuleIds: ["rate-limit.missing", "rate-limit.auth-missing", "rate-limit.admin-missing"],
    categoryKeywords: ["availability"],
    titleKeywords: ["rate limit", "throttl", "brute", "authentication route"],
  },
  {
    adapterIds: ["mass-assignment-probe"],
    staticRuleIds: ["api.mass-assignment", "validation.missing", "validation.client-only-risk"],
    categoryKeywords: ["validation", "api"],
    titleKeywords: ["validation", "mass assignment", "request body", "client-only"],
  },
  {
    adapterIds: ["injection-probe-safe"],
    staticRuleIds: [
      "injection.sql",
      "injection.command",
      "injection.path-traversal",
      "injection.deserialization",
      "web.next-xss",
      "database.unsafe-raw-query",
    ],
    categoryKeywords: ["injection", "xss"],
    titleKeywords: ["sql", "injection", "xss", "command", "path", "traversal", "raw query"],
  },
  {
    adapterIds: ["ssrf-probe-safe"],
    staticRuleIds: ["injection.ssrf"],
    categoryKeywords: ["injection"],
    titleKeywords: ["ssrf", "server-side request", "outbound request"],
  },
  {
    adapterIds: ["cors-misconfiguration", "security-headers-probe"],
    staticRuleIds: ["web.permissive-cors", "web.csrf-missing"],
    categoryKeywords: ["configuration", "web"],
    titleKeywords: ["cors", "cross-origin", "csrf", "content-security-policy"],
  },
  {
    adapterIds: ["webhook-signature-bypass"],
    staticRuleIds: ["web.webhook"],
    categoryKeywords: ["web", "webhook"],
    titleKeywords: ["webhook", "signature"],
  },
  {
    adapterIds: ["idempotency-replay"],
    staticRuleIds: ["reliability.idempotency"],
    categoryKeywords: ["reliability", "availability"],
    titleKeywords: ["idempotency", "replay", "duplicate"],
  },
  {
    adapterIds: ["double-credit-consumption"],
    categoryKeywords: ["business_logic", "payments"],
    titleKeywords: ["credit", "quota", "consumption", "double"],
  },
  {
    adapterIds: ["workflow-bypass"],
    categoryKeywords: ["business_logic"],
    titleKeywords: ["workflow", "checkout", "state"],
  },
  {
    adapterIds: ["rag-prompt-injection", "rag-poisoning"],
    categoryKeywords: ["llm"],
    titleKeywords: ["rag", "prompt", "injection"],
  },
  {
    adapterIds: ["unauthorized-tool-invocation"],
    categoryKeywords: ["llm"],
    titleKeywords: ["tool", "agent", "function"],
  },
  {
    adapterIds: ["memory-isolation"],
    categoryKeywords: ["llm"],
    titleKeywords: ["memory", "isolation", "cross-user"],
  },
  {
    adapterIds: ["idor-cross-tenant"],
    staticRuleIds: ["supabase.rls", "supabase.rls-missing", "database.rls-assessment"],
    categoryKeywords: ["authorization", "database"],
    titleKeywords: ["rls", "row level"],
  },
  {
    adapterIds: [],
    staticRuleIds: ["secrets.exposed", "secrets.public-env", "supabase.service-role-client"],
    categoryKeywords: ["secrets"],
    titleKeywords: ["secret", "credential", "api key", "service role"],
  },
  {
    adapterIds: [],
    staticRuleIds: ["cicd.github-actions-secrets", "cicd.github-actions-permissions"],
    categoryKeywords: ["cicd"],
    titleKeywords: ["github actions", "workflow", "pull_request_target"],
  },
  {
    adapterIds: [],
    staticRuleIds: ["api.error-leakage"],
    categoryKeywords: ["api"],
    titleKeywords: ["error", "stack trace", "verbose"],
  },
];

export function staticFindingMatchesRule(
  finding: { ruleId?: string | null; category?: string | null; title?: string | null },
  rule: CorrelationRule
): boolean {
  const ruleId = (finding.ruleId ?? "").toLowerCase();
  const category = (finding.category ?? "").toLowerCase();
  const title = (finding.title ?? "").toLowerCase();

  if (rule.staticRuleIds?.some((id) => ruleId === id.toLowerCase())) return true;
  if (rule.categoryKeywords?.some((kw) => category.includes(kw.toLowerCase()))) return true;
  // Match title keywords against ruleId/title only — never a joined "category title"
  // string, which can accidentally contain a keyword spanning the field boundary
  // (e.g. category "authentication" + title "Route has no visible authentication"
  // joined as "...authentication route has no visible authentication" falsely
  // matches a keyword like "authentication route" meant for a different rule).
  if (
    rule.titleKeywords?.some(
      (kw) => ruleId.includes(kw.toLowerCase()) || title.includes(kw.toLowerCase())
    )
  )
    return true;
  return false;
}

/** Confirmation requires an explicit static rule ID match — never keyword-only. */
export function staticFindingMatchesRuleForConfirmation(
  finding: { ruleId?: string | null; category?: string | null; title?: string | null },
  rule: CorrelationRule
): boolean {
  const ruleId = (finding.ruleId ?? "").toLowerCase();
  if (!rule.staticRuleIds?.length) return false;
  return rule.staticRuleIds.some((id) => ruleId === id.toLowerCase());
}

export function isHeuristicSecurityAnalysisFinding(input: {
  ruleId?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (input.metadata?.securityAnalysis) return true;
  const ruleId = (input.ruleId ?? "").toLowerCase();
  return (
    ruleId.startsWith("agent-scanner.osv.") ||
    ruleId.startsWith("mcp.") ||
    ruleId.startsWith("package-security.") ||
    ruleId.startsWith("prompt-injection.") ||
    ruleId.startsWith("agent-action.") ||
    ruleId.startsWith("git-diff.") ||
    ruleId.includes(".osv.")
  );
}

export function attackFindingMatchesRule(
  finding: { adapterId?: string | null; category?: string | null; title?: string | null },
  rule: CorrelationRule
): boolean {
  const adapterId = (finding.adapterId ?? "").toLowerCase();
  if (rule.adapterIds.length > 0 && rule.adapterIds.some((id) => id.toLowerCase() === adapterId)) {
    return true;
  }
  const category = (finding.category ?? "").toLowerCase();
  const title = (finding.title ?? "").toLowerCase();
  // Check each field independently — see staticFindingMatchesRule for why a
  // joined "adapterId category title" string is unsafe (accidental cross-field
  // substring matches at the join boundary).
  if (rule.categoryKeywords?.some((kw) => category.includes(kw.toLowerCase()))) return true;
  if (
    rule.titleKeywords?.some(
      (kw) => adapterId.includes(kw.toLowerCase()) || title.includes(kw.toLowerCase())
    )
  )
    return true;
  return false;
}
