import type { RuleInfo } from "./schema";

const RULE_CATALOG: Record<string, Omit<RuleInfo, "ruleId">> = {
  "secrets.exposed": {
    ruleName: "Hard-coded secret",
    ruleDescription: "Detects credential-like values committed in source control.",
    category: "secrets",
    owasp: ["A02:2021 – Cryptographic Failures"],
    cwe: ["CWE-798: Use of Hard-coded Credentials"],
    mitreAttack: ["T1552.001"],
  },
  "secrets.public-env": {
    ruleName: "Secret exposed to client bundle",
    ruleDescription: "Client-prefixed environment variables are shipped to browsers.",
    category: "secrets",
    owasp: ["A02:2021 – Cryptographic Failures"],
    cwe: ["CWE-200: Exposure of Sensitive Information"],
  },
  "supabase.service-role-client": {
    ruleName: "Supabase service role in client code",
    ruleDescription: "Service-role keys bypass row-level security and must stay server-side.",
    category: "secrets",
    owasp: ["A01:2021 – Broken Access Control"],
    cwe: ["CWE-522: Insufficiently Protected Credentials"],
  },
  "auth.missing-route-guard": {
    ruleName: "Missing route authentication",
    ruleDescription: "Sensitive route handlers appear to accept unauthenticated requests.",
    category: "authentication",
    owasp: ["A01:2021 – Broken Access Control"],
    cwe: ["CWE-306: Missing Authentication for Critical Function"],
  },
  "idor-cross-tenant": {
    ruleName: "Cross-tenant data access",
    ruleDescription: "Resource access may not bind records to the authenticated tenant.",
    category: "authorization",
    owasp: ["A01:2021 – Broken Access Control"],
    cwe: ["CWE-639: Authorization Bypass Through User-Controlled Key"],
  },
  "unauthenticated-endpoint": {
    ruleName: "Unauthenticated endpoint",
    ruleDescription: "Protected route accepted a request without verified credentials.",
    category: "authentication",
    owasp: ["A01:2021 – Broken Access Control"],
    cwe: ["CWE-306: Missing Authentication for Critical Function"],
  },
};

export function lookupRuleInfo(ruleId: string, fallbackTitle: string, category: string): RuleInfo {
  const known = RULE_CATALOG[ruleId];
  if (known) {
    return { ruleId, ...known };
  }
  return {
    ruleId,
    ruleName: fallbackTitle,
    category,
  };
}
