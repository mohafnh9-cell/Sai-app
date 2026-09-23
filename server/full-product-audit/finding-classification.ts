import { isNonBlockingSecretClassification } from "@/features/security-scanner/rules/secret-classification";
import type { SecretEvidenceClassification } from "@/features/security-scanner/rules/secret-classification";

/**
 * Structured, rule-based finding classification. Nothing here reads a
 * finding's title or free text: a title such as "secrets coverage evaluated"
 * is prose, not a security fact, and must never decide whether a user is told
 * to remove or rotate a credential.
 */

/** Rules that report a credential/secret-related security finding. */
const CREDENTIAL_RULE_IDS = new Set(["secrets.exposed", "secrets.public-env"]);

/** Rules that only record which areas of the repository were evaluated. */
const COVERAGE_BASELINE_RULE_IDS = new Set(["security.area-baseline", "readiness.area-baseline"]);

type ClassifiableFinding = {
  ruleId?: string | null;
  secretClassification?: SecretEvidenceClassification | null;
};

function normalizedRuleId(finding: ClassifiableFinding): string {
  return (finding.ruleId ?? "").trim().toLowerCase();
}

/** A coverage baseline is evidence of what was looked at, never a finding. */
export function isCoverageBaselineFinding(finding: ClassifiableFinding): boolean {
  return COVERAGE_BASELINE_RULE_IDS.has(normalizedRuleId(finding));
}

/** The finding was produced by an explicitly classified secret rule. */
export function isCredentialFinding(finding: ClassifiableFinding): boolean {
  if (isCoverageBaselineFinding(finding)) return false;
  return CREDENTIAL_RULE_IDS.has(normalizedRuleId(finding));
}

/**
 * Whether the user should be told to remove/rotate a credential: only for a
 * genuine secret-rule finding that has not been classified as a test
 * fixture, placeholder or false positive.
 */
export function requiresCredentialRemediation(finding: ClassifiableFinding): boolean {
  if (!isCredentialFinding(finding)) return false;
  return !isNonBlockingSecretClassification(finding.secretClassification ?? undefined);
}
