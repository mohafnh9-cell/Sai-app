import type { Finding } from "@/features/security-scanner/types";
import { analyzeProjectContext, projectAwareRecommendation, type ProjectContext } from "./project-context";
import type { EvidenceReport, EvidenceItem } from "./schema";
import { lookupRuleInfo } from "./rule-catalog";
import { computeConfidenceScore, confidencePercent } from "./compute-confidence";
import { deriveConfidenceFromEvidenceScore } from "@/brain/confidence/derive";
import {
  computeFalsePositiveProbability,
  falsePositiveLabel,
  falsePositivePercent,
} from "./compute-false-positive";
import {
  buildSecretEvidenceItems,
  identifySecretProvider,
  secretRemediation,
} from "./secret-evidence";
import { EVIDENCE_REPORT_METADATA_KEY } from "./schema";
import {
  isNonBlockingSecretClassification,
  SECRET_CLASSIFICATION_METADATA_KEY,
  type SecretEvidenceClassification,
} from "@/features/security-scanner/rules/secret-classification";
import {
  buildRepositoryModel,
  gateScanFindings,
  type RepositoryModel,
} from "@/brain/repository-model";
import { collectPlatformInjectionFindings } from "@/server/mcp/security";
import { isPlatformInjectionFinding } from "@/server/mcp/security/platform-finding";
import { detectStack } from "@/features/security-scanner/stack";
import { stubNormalizedFile } from "@/features/security-scanner/normalization";
import type { NormalizedFile } from "@/features/security-scanner/types";

export function shouldSuppressPublicWebsiteFinding(
  finding: Pick<Finding, "ruleId" | "title" | "category">,
  context: ProjectContext
): boolean {
  if (context.projectType !== "marketing_website" && context.projectType !== "landing_page") {
    return false;
  }
  const haystack = `${finding.ruleId} ${finding.title} ${finding.category}`.toLowerCase();
  return (
    haystack.includes("unauthenticated") ||
    haystack.includes("missing auth") ||
    haystack.includes("missing-auth") ||
    haystack.includes("public endpoint")
  );
}

export function enrichScanFinding(input: {
  finding: Finding;
  projectContext: ProjectContext;
  repositoryModel?: RepositoryModel;
}): Finding {
  if (isPlatformInjectionFinding(input.finding)) {
    const report = buildScanEvidenceReport(input.finding, input.projectContext);
    return {
      ...input.finding,
      confidence: "low",
      metadata: {
        ...(input.finding.metadata ?? {}),
        [EVIDENCE_REPORT_METADATA_KEY]: {
          ...report,
          confidence: Math.min(report.confidence, 0.35),
          confidencePercent: Math.min(report.confidencePercent, 35),
          confirmationStatus: "UNVERIFIED",
          confidenceExplanation:
            "Platform guard detected a prompt injection attempt in untrusted repository content. This signal cannot upgrade other findings.",
        },
      },
    };
  }

  if (shouldSuppressPublicWebsiteFinding(input.finding, input.projectContext)) {
    return {
      ...input.finding,
      metadata: {
        ...(input.finding.metadata ?? {}),
        suppressed: true,
        suppressionReason: "public_website_intentional_access",
        [EVIDENCE_REPORT_METADATA_KEY]: buildSuppressedReport(input.finding, input.projectContext),
      },
    };
  }

  const existingReport = readExistingEvidenceReport(input.finding);
  if (existingReport && isExternalSecurityAnalysisFinding(input.finding)) {
    return {
      ...input.finding,
      remediation:
        input.finding.category === "secrets"
          ? buildSecretRemediation(input.finding)
          : projectAwareRecommendation({
              genericRecommendation: input.finding.remediation,
              context: input.projectContext,
              adapterId: input.finding.ruleId,
            }),
      metadata: {
        ...(input.finding.metadata ?? {}),
        [EVIDENCE_REPORT_METADATA_KEY]: existingReport,
      },
    };
  }

  const report = buildScanEvidenceReport(input.finding, input.projectContext);
  const remediation =
    input.finding.category === "secrets"
      ? buildSecretRemediation(input.finding)
      : projectAwareRecommendation({
          genericRecommendation: input.finding.remediation,
          context: input.projectContext,
          adapterId: input.finding.ruleId,
        });

  return {
    ...input.finding,
    remediation,
    metadata: {
      ...(input.finding.metadata ?? {}),
      [EVIDENCE_REPORT_METADATA_KEY]: report,
    },
  };
}

function buildSecretRemediation(finding: Finding): string {
  const secret = identifySecretProvider({
    evidence: finding.evidence,
    ruleId: finding.ruleId,
    fingerprintMaterial:
      typeof finding.metadata?.fingerprintMaterial === "string"
        ? finding.metadata.fingerprintMaterial
        : undefined,
  });
  if (!secret) return finding.remediation;
  return secretRemediation({
    provider: secret.provider,
    ruleId: secret.ruleId,
    filePath: finding.location.path,
    line: finding.location.line,
    partialFingerprint: secret.partialFingerprint,
  });
}

function buildSuppressedReport(finding: Finding, context: ProjectContext): EvidenceReport {
  return {
    version: 1,
    detectionMethod: "STATIC_ANALYSIS",
    confidence: 0.2,
    confidenceLevel: "SPECULATIVE",
    confidencePercent: 20,
    confidenceExplanation: "Finding suppressed because the project appears to be a public marketing site.",
    falsePositiveProbability: 0.85,
    falsePositivePercent: 85,
    falsePositiveExplanation: "Public pages returning HTTP 200 are expected for marketing websites.",
    confirmationStatus: "suppressed",
    statusLabel: "Suppressed — likely intentional public access",
    evidence: [],
    counterEvidence: [
      {
        id: "project-type",
        kind: "project_classification",
        label: "Project classified as public website",
        detail: context.projectType,
      },
    ],
    reasoning: `This ${finding.title} finding was suppressed because SequrAI classified the repository as a ${context.projectType.replaceAll("_", " ")} where public routes are often intentional.`,
    affectedFiles: [{ path: finding.location.path, line: finding.location.line, matchedRule: finding.ruleId }],
    matchedRules: [lookupRuleInfo(finding.ruleId, finding.title, finding.category)],
    projectType: context.projectType,
  };
}

function readExistingEvidenceReport(finding: Finding): EvidenceReport | undefined {
  const report = finding.metadata?.[EVIDENCE_REPORT_METADATA_KEY];
  return report && typeof report === "object" ? (report as EvidenceReport) : undefined;
}

function isExternalSecurityAnalysisFinding(finding: Finding): boolean {
  const securityAnalysis = finding.metadata?.securityAnalysis;
  if (securityAnalysis && typeof securityAnalysis === "object") {
    return true;
  }
  return (
    finding.ruleId.startsWith("agent-scanner.") ||
    finding.ruleId.startsWith("dependencies.") ||
    finding.ruleId.endsWith(".security") ||
    finding.ruleId.includes("package-security")
  );
}

function buildScanEvidenceReport(finding: Finding, context: ProjectContext): EvidenceReport {
  const rule = lookupRuleInfo(finding.ruleId, finding.title, finding.category);
  const evidenceItems = buildStaticEvidenceItems(finding);
  const counterEvidence = buildStaticCounterEvidence(finding, context);
  const secretClassification = finding.metadata?.[SECRET_CLASSIFICATION_METADATA_KEY] as
    | SecretEvidenceClassification
    | undefined;
  const isSecret = finding.category === "secrets";
  const secret = isSecret
    ? identifySecretProvider({
        evidence: finding.evidence,
        ruleId: finding.ruleId,
        fingerprintMaterial:
          typeof finding.metadata?.fingerprintMaterial === "string"
            ? finding.metadata.fingerprintMaterial
            : undefined,
      })
    : null;

  if (secretClassification && isNonBlockingSecretClassification(secretClassification)) {
    counterEvidence.push({
      id: "secret-classification",
      kind: "secret_classification",
      label: "Secret classification",
      detail: secretClassification,
      confidence: 0.9,
    });
  }

  if (secret && !isNonBlockingSecretClassification(secretClassification)) {
    evidenceItems.push(...buildSecretEvidenceItems({
      provider: secret.provider,
      ruleId: secret.ruleId,
      filePath: finding.location.path,
      line: finding.location.line,
      partialFingerprint: secret.partialFingerprint,
      regexMatched: true,
    }));
  }

  const { confidence, explanation } = computeConfidenceScore({
    detectionMethod: "STATIC_ANALYSIS",
    evidenceItems,
    severity: finding.severity,
    hasRuntimeEvidence: false,
    hasReplayEvidence: false,
  });

  const reasoning = buildScanReasoning(finding, evidenceItems, secret, secretClassification);
  const nonBlockingSecret = isNonBlockingSecretClassification(secretClassification);
  const externalFinding = isExternalSecurityAnalysisFinding(finding);
  const adjustedConfidence = nonBlockingSecret ? Math.min(confidence, 0.35) : confidence;
  const verificationStatusForConfidence =
    externalFinding || nonBlockingSecret
      ? ("POTENTIAL" as const)
      : adjustedConfidence >= 0.75
        ? ("CONFIRMED" as const)
        : ("POTENTIAL" as const);
  const { level: confidenceLevel } = deriveConfidenceFromEvidenceScore({
    detectionMethod: "STATIC_ANALYSIS",
    evidenceItems,
    severity: finding.severity,
    hasRuntimeEvidence: false,
    hasReplayEvidence: false,
    verificationStatus: verificationStatusForConfidence,
    suppressed: false,
    llmOnly: externalFinding,
  });

  const { probability, explanation: fpExplanation } = computeFalsePositiveProbability({
    detectionMethod: "STATIC_ANALYSIS",
    evidenceItems,
    counterEvidenceItems: counterEvidence,
    projectType: context.projectType,
    ruleId: finding.ruleId,
    isSecretFinding: isSecret,
    hasProviderMatch: Boolean(secret),
    hasEntropySignal: isSecret,
    hasRuntimeUsage: false,
  });

  const confirmation = externalFinding
    ? {
        confirmationStatus: "potential_vulnerability" as const,
        statusLabel: "Potential issue — external scanner signal pending verification",
      }
    : nonBlockingSecret
      ? {
          confirmationStatus: "not_exploitable" as const,
          statusLabel: "Test fixture — no production action required",
        }
      : confidence >= 0.75
        ? {
            confirmationStatus: "confirmed" as const,
            statusLabel: "Confirmed by static analysis",
          }
        : {
            confirmationStatus: "potential_vulnerability" as const,
            statusLabel: "Potential issue — review evidence",
          };

  return {
    version: 1,
    detectionMethod: "STATIC_ANALYSIS",
    confidence: adjustedConfidence,
    confidenceLevel,
    confidencePercent: confidencePercent(adjustedConfidence),
    confidenceExplanation: nonBlockingSecret
      ? "SequrAI classified this value as a test fixture or placeholder rather than a production credential."
      : externalFinding
        ? "External security scanner signal — SequrAI requires verification before treating this as confirmed."
        : explanation,
    falsePositiveProbability: nonBlockingSecret ? Math.max(probability, 0.8) : probability,
    falsePositivePercent: falsePositivePercent(nonBlockingSecret ? Math.max(probability, 0.8) : probability),
    falsePositiveExplanation: nonBlockingSecret
      ? "Likely test fixture — does not block production readiness."
      : `${falsePositiveLabel(probability)} — ${fpExplanation}`,
    confirmationStatus: confirmation.confirmationStatus,
    statusLabel: confirmation.statusLabel,
    evidence: evidenceItems,
    counterEvidence,
    reasoning,
    affectedFiles: [
      {
        path: finding.location.path,
        line: finding.location.line,
        column: finding.location.column,
        matchedRule: finding.ruleId,
      },
    ],
    matchedRules: [rule],
    verificationStatus: "Not runtime verified",
    recommendedFix: isSecret
      ? buildSecretRemediation(finding)
      : projectAwareRecommendation({
          genericRecommendation: finding.remediation,
          context,
          adapterId: finding.ruleId,
        }),
    safeFixConfidence: Math.min(0.92, confidence + 0.05),
    projectType: context.projectType,
  };
}

function buildStaticEvidenceItems(finding: Finding): EvidenceItem[] {
  const items: EvidenceItem[] = [
    {
      id: "static-rule",
      kind: "static_rule_match",
      label: "Static rule matched",
      detail: `${finding.ruleId} at ${finding.location.path}:${finding.location.line}`,
      confidence: finding.confidence === "high" ? 0.85 : finding.confidence === "medium" ? 0.65 : 0.45,
    },
  ];
  if (finding.evidence) {
    items.push({
      id: "snippet",
      kind: "code_evidence",
      label: "Matched pattern",
      detail: finding.evidence,
      confidence: 0.7,
    });
  }
  return items;
}

function buildStaticCounterEvidence(finding: Finding, context: ProjectContext): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  if (/example|sample|test|mock|fixture/i.test(finding.location.path)) {
    items.push({
      id: "test-path",
      kind: "test_file",
      label: "Match in test or example path",
      detail: finding.location.path,
    });
  }
  if (context.projectType === "marketing_website") {
    items.push({
      id: "public-site",
      kind: "project_classification",
      label: "Public website classification",
      detail: "Some routes may intentionally be public.",
    });
  }
  if (finding.category === "secrets" && !finding.evidence?.includes("sk_")) {
    items.push({
      id: "no-runtime",
      kind: "missing_runtime_usage",
      label: "No runtime usage observed",
      detail: "Static match only — credential may be inactive.",
    });
  }
  return items;
}

function buildScanReasoning(
  finding: Finding,
  evidence: EvidenceItem[],
  secret: ReturnType<typeof identifySecretProvider>,
  secretClassification?: SecretEvidenceClassification
): string {
  if (secretClassification === "TEST_FIXTURE") {
    return `SequrAI matched a credential-like assignment in ${finding.location.path}:${finding.location.line}, but the value appears to be a test fixture based on file context, naming, and nearby test code. It should not block production readiness.`;
  }
  if (secretClassification === "PLACEHOLDER") {
    return `SequrAI matched a credential-like assignment in ${finding.location.path}:${finding.location.line}, but the value reads like a placeholder rather than a live credential. Confirm it is not used in production.`;
  }
  if (secretClassification === "FALSE_POSITIVE") {
    return `SequrAI matched a credential-like pattern in ${finding.location.path}:${finding.location.line}, but the assigned value is not a literal secret.`;
  }
  if (secret) {
    return `SequrAI matched rule ${secret.ruleId} for ${secret.provider} at ${finding.location.path}:${finding.location.line}. The pattern, provider format, and file location align with a committed credential (${secret.partialFingerprint}).`;
  }
  return `SequrAI matched static rule ${finding.ruleId} in ${finding.location.path} at line ${finding.location.line}. ${evidence.length} evidence item(s) support this conclusion. Review counter-evidence before acting.`;
}

export function postProcessScanFindings(
  findings: Finding[],
  filePaths: readonly string[],
  normalizedFiles?: readonly NormalizedFile[]
): Finding[] {
  const context = analyzeProjectContext(filePaths);
  const model =
    normalizedFiles != null
      ? buildRepositoryModel(normalizedFiles, detectStack([...normalizedFiles]))
      : buildRepositoryModel(
          filePaths.map((path) => stubNormalizedFile(path)),
          detectStack([])
        );

  const platformFindings = collectPlatformInjectionFindings(findings, normalizedFiles);

  const enriched = [...findings, ...platformFindings]
    .map((finding) => enrichScanFinding({ finding, projectContext: context, repositoryModel: model }))
    .filter((finding) => !finding.metadata?.suppressed);

  const { accepted } = gateScanFindings(enriched, model);
  return accepted;
}
