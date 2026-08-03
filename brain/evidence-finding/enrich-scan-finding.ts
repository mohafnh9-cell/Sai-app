import type { Finding } from "@/features/security-scanner/types";
import { analyzeProjectContext, projectAwareRecommendation, type ProjectContext } from "./project-context";
import type { EvidenceReport, EvidenceItem } from "./schema";
import { lookupRuleInfo } from "./rule-catalog";
import { computeConfidenceScore, confidencePercent } from "./compute-confidence";
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
  buildRepositoryModel,
  gateScanFindings,
  type RepositoryModel,
} from "@/brain/repository-model";
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

function buildScanEvidenceReport(finding: Finding, context: ProjectContext): EvidenceReport {
  const rule = lookupRuleInfo(finding.ruleId, finding.title, finding.category);
  const evidenceItems = buildStaticEvidenceItems(finding);
  const counterEvidence = buildStaticCounterEvidence(finding, context);
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

  if (secret) {
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

  const reasoning = buildScanReasoning(finding, evidenceItems, secret);

  return {
    version: 1,
    detectionMethod: "STATIC_ANALYSIS",
    confidence,
    confidencePercent: confidencePercent(confidence),
    confidenceExplanation: explanation,
    falsePositiveProbability: probability,
    falsePositivePercent: falsePositivePercent(probability),
    falsePositiveExplanation: `${falsePositiveLabel(probability)} — ${fpExplanation}`,
    confirmationStatus: confidence >= 0.75 ? "confirmed" : "potential_vulnerability",
    statusLabel: confidence >= 0.75 ? "Confirmed by static analysis" : "Potential issue — review evidence",
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
    recommendedFix: projectAwareRecommendation({
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
  secret: ReturnType<typeof identifySecretProvider>
): string {
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

  const enriched = findings
    .map((finding) => enrichScanFinding({ finding, projectContext: context, repositoryModel: model }))
    .filter((finding) => !finding.metadata?.suppressed);

  const { accepted } = gateScanFindings(enriched, model);
  return accepted;
}
