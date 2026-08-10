import {
  isNonBlockingSecretClassification,
  SECRET_CLASSIFICATION_METADATA_KEY,
  type SecretEvidenceClassification,
} from "@/features/security-scanner/rules/secret-classification";
import {
  AUDIT_CORRELATION_RULES,
  attackFindingMatchesRule,
  staticFindingMatchesRule,
} from "./correlation-rules";
import type { ConsolidatedAuditFinding, FindingVerificationStatus } from "./types";

export type StaticFindingInput = {
  id: string;
  ruleId?: string | null;
  title: string;
  description?: string | null;
  severity: string;
  category?: string | null;
  filePath?: string | null;
  startLine?: number | null;
  recommendation?: string | null;
  confidence?: string | null;
  evidence?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AttackFindingInput = {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  category?: string | null;
  outcome: string;
  impact?: string | null;
  adapterId?: string | null;
  confidence?: number | null;
};

function normalizeConfidence(value: string | number | null | undefined): "high" | "medium" | "low" {
  if (typeof value === "number") {
    if (value >= 0.8) return "high";
    if (value >= 0.5) return "medium";
    return "low";
  }
  const normalized = String(value ?? "medium").toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "medium";
}

function severityRank(severity: string): number {
  switch (severity.toLowerCase()) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

function pickHigherSeverity(a: string, b: string): string {
  return severityRank(a) >= severityRank(b) ? a : b;
}

function findCorrelationRule(
  staticFinding: StaticFindingInput,
  attackFinding: AttackFindingInput
): boolean {
  return AUDIT_CORRELATION_RULES.some(
    (rule) =>
      staticFindingMatchesRule(staticFinding, rule) &&
      attackFindingMatchesRule(attackFinding, rule)
  );
}

function staticHasRunnableTest(
  staticFinding: StaticFindingInput,
  executedAdapters: ReadonlySet<string>
): boolean {
  return AUDIT_CORRELATION_RULES.some((rule) => {
    if (!staticFindingMatchesRule(staticFinding, rule)) return false;
    if (rule.adapterIds.length === 0) return false;
    return rule.adapterIds.some((adapterId) => executedAdapters.has(adapterId));
  });
}

function mapCorrelatedVerification(
  attackOutcome: string,
  confirmed: boolean
): FindingVerificationStatus {
  if (confirmed) return "CONFIRMED";
  if (attackOutcome === "not_exploitable") return "FALSE_POSITIVE";
  if (attackOutcome === "inconclusive") return "UNVERIFIED";
  return "NOT_REPRODUCED";
}

function secretClassificationFromStatic(
  finding: StaticFindingInput
): SecretEvidenceClassification | undefined {
  const value = finding.metadata?.[SECRET_CLASSIFICATION_METADATA_KEY];
  return typeof value === "string" ? (value as SecretEvidenceClassification) : undefined;
}

function isInformationalPass(finding: StaticFindingInput): boolean {
  const evidence = (finding.evidence ?? "").toUpperCase();
  const secretClassification = secretClassificationFromStatic(finding);
  if (isNonBlockingSecretClassification(secretClassification)) return true;
  return evidence.includes("RLS=PASS") || finding.severity.toLowerCase() === "info";
}

export function isProductionBlockingAuditFinding(finding: ConsolidatedAuditFinding): boolean {
  if (isNonBlockingSecretClassification(finding.secretClassification)) return false;
  return finding.severity.toLowerCase() === "critical" || finding.severity.toLowerCase() === "high";
}

export function correlateAuditFindings(input: {
  staticFindings: StaticFindingInput[];
  attackFindings: AttackFindingInput[];
  executedAdapters: readonly string[];
  priorityFindingIds?: readonly string[];
}): ConsolidatedAuditFinding[] {
  const executedAdapterSet = new Set(input.executedAdapters.map((id) => id.toLowerCase()));
  const matchedStaticIds = new Set<string>();
  const matchedAttackIds = new Set<string>();
  const consolidated: ConsolidatedAuditFinding[] = [];

  for (const staticFinding of input.staticFindings) {
    for (const attackFinding of input.attackFindings) {
      if (!findCorrelationRule(staticFinding, attackFinding)) continue;
      matchedStaticIds.add(staticFinding.id);
      matchedAttackIds.add(attackFinding.id);

      const confirmed = attackFinding.outcome === "confirmed";
      const verificationStatus = mapCorrelatedVerification(attackFinding.outcome, confirmed);

      consolidated.push({
        id: `confirmed:${staticFinding.id}:${attackFinding.id}`,
        severity: pickHigherSeverity(staticFinding.severity, attackFinding.severity),
        category: staticFinding.category ?? attackFinding.category ?? "security",
        title: staticFinding.title,
        description: attackFinding.description ?? staticFinding.description ?? staticFinding.title,
        source: "both",
        verificationStatus,
        evidence: [
          staticFinding.evidence
            ? `Static: ${staticFinding.evidence}`
            : `Static rule ${staticFinding.ruleId ?? "unknown"} at ${staticFinding.filePath ?? "unknown"}`,
          `Dynamic (${attackFinding.adapterId ?? "test"}): ${attackFinding.outcome} — ${attackFinding.impact ?? attackFinding.title}`,
        ],
        confidence: confirmed ? "high" : normalizeConfidence(staticFinding.confidence),
        affectedComponent: staticFinding.filePath ?? attackFinding.adapterId ?? null,
        line: staticFinding.startLine ?? undefined,
        recommendation: staticFinding.recommendation ?? attackFinding.impact ?? null,
        safeFixAvailable:
          (input.priorityFindingIds?.includes(staticFinding.id) ?? false) ||
          severityRank(staticFinding.severity) >= 4 ||
          verificationStatus === "CONFIRMED",
        staticFindingId: staticFinding.id,
        attackFindingId: attackFinding.id,
        adapterId: attackFinding.adapterId ?? undefined,
        ruleId: staticFinding.ruleId ?? undefined,
        secretClassification: secretClassificationFromStatic(staticFinding),
      });
    }
  }

  for (const staticFinding of input.staticFindings) {
    if (matchedStaticIds.has(staticFinding.id)) continue;

    if (isInformationalPass(staticFinding)) {
      consolidated.push({
        id: `static:${staticFinding.id}`,
        severity: staticFinding.severity,
        category: staticFinding.category ?? "security",
        title: staticFinding.title,
        description: staticFinding.description ?? staticFinding.title,
        source: "code_review",
        verificationStatus: "NOT_APPLICABLE",
        evidence: [
          staticFinding.evidence
            ? `Static: ${staticFinding.evidence}`
            : `Static rule ${staticFinding.ruleId ?? "unknown"} at ${staticFinding.filePath ?? "unknown"}`,
        ],
        confidence: normalizeConfidence(staticFinding.confidence),
        affectedComponent: staticFinding.filePath ?? null,
        line: staticFinding.startLine ?? undefined,
        recommendation: staticFinding.recommendation ?? null,
        safeFixAvailable: false,
        staticFindingId: staticFinding.id,
        ruleId: staticFinding.ruleId ?? undefined,
        secretClassification: secretClassificationFromStatic(staticFinding),
      });
      continue;
    }

    const runnable = staticHasRunnableTest(staticFinding, executedAdapterSet);
    consolidated.push({
      id: `static:${staticFinding.id}`,
      severity: staticFinding.severity,
      category: staticFinding.category ?? "security",
      title: staticFinding.title,
      description: staticFinding.description ?? staticFinding.title,
      source: "code_review",
      verificationStatus: runnable ? "POTENTIAL" : "POTENTIAL",
      evidence: [
        staticFinding.evidence
          ? `Static: ${staticFinding.evidence}`
          : `Static rule ${staticFinding.ruleId ?? "unknown"} at ${staticFinding.filePath ?? "unknown"}`,
        runnable
          ? "Dynamic test available — run Full Product Audit with security tests to attempt confirmation."
          : "Static analysis only — no matching attack adapter executed for this category.",
      ],
      confidence: normalizeConfidence(staticFinding.confidence),
      affectedComponent: staticFinding.filePath ?? null,
      line: staticFinding.startLine ?? undefined,
      recommendation: staticFinding.recommendation ?? null,
      safeFixAvailable:
        input.priorityFindingIds?.includes(staticFinding.id) ?? severityRank(staticFinding.severity) >= 4,
      staticFindingId: staticFinding.id,
      ruleId: staticFinding.ruleId ?? undefined,
      secretClassification: secretClassificationFromStatic(staticFinding),
    });
  }

  for (const attackFinding of input.attackFindings) {
    if (matchedAttackIds.has(attackFinding.id)) continue;

    const verificationStatus: FindingVerificationStatus =
      attackFinding.outcome === "confirmed"
        ? "CONFIRMED"
        : attackFinding.outcome === "not_exploitable"
          ? "FALSE_POSITIVE"
          : attackFinding.outcome === "inconclusive"
            ? "LIKELY"
            : "NOT_REPRODUCED";

    if (verificationStatus === "FALSE_POSITIVE" || verificationStatus === "NOT_REPRODUCED") {
      continue;
    }

    consolidated.push({
      id: `dynamic:${attackFinding.id}`,
      severity: attackFinding.severity,
      category: attackFinding.category ?? "security",
      title: attackFinding.title,
      description: attackFinding.description ?? attackFinding.title,
      source: "security_test",
      verificationStatus,
      evidence: [
        `Dynamic (${attackFinding.adapterId ?? "test"}): ${attackFinding.outcome} — ${attackFinding.impact ?? attackFinding.title}`,
      ],
      confidence: normalizeConfidence(attackFinding.confidence),
      affectedComponent: attackFinding.adapterId ?? null,
      recommendation: attackFinding.impact ?? null,
      safeFixAvailable: severityRank(attackFinding.severity) >= 4,
      attackFindingId: attackFinding.id,
      adapterId: attackFinding.adapterId ?? undefined,
    });
  }

  return consolidated.sort((a, b) => {
    const severityDiff = severityRank(b.severity) - severityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;
    const confirmedDiff =
      (b.verificationStatus === "CONFIRMED" ? 1 : 0) -
      (a.verificationStatus === "CONFIRMED" ? 1 : 0);
    if (confirmedDiff !== 0) return confirmedDiff;
    return a.title.localeCompare(b.title);
  });
}

export function countAuditFindings(findings: ConsolidatedAuditFinding[]) {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    confirmed: 0,
    likely: 0,
    potential: 0,
    notReproduced: 0,
    falsePositive: 0,
    notApplicable: 0,
  };

  for (const finding of findings) {
    switch (finding.severity.toLowerCase()) {
      case "critical":
        counts.critical += 1;
        break;
      case "high":
        counts.high += 1;
        break;
      case "medium":
        counts.medium += 1;
        break;
      case "low":
        counts.low += 1;
        break;
      case "info":
        counts.info += 1;
        break;
    }
    switch (finding.verificationStatus) {
      case "CONFIRMED":
        counts.confirmed += 1;
        break;
      case "LIKELY":
        counts.likely += 1;
        break;
      case "POTENTIAL":
        counts.potential += 1;
        break;
      case "NOT_REPRODUCED":
        counts.notReproduced += 1;
        break;
      case "FALSE_POSITIVE":
        counts.falsePositive += 1;
        break;
      case "NOT_APPLICABLE":
        counts.notApplicable += 1;
        break;
      case "UNVERIFIED":
        counts.notReproduced += 1;
        break;
    }
  }

  return counts;
}
