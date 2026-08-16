import "server-only";

import { verdictHeadline } from "@/brain/production-verdict/status-rules";
import type { McpTranslator } from "@/server/mcp/i18n";
import { buildTextResponse } from "@/server/mcp/response-format";
import {
  buildAwaitingScopeApprovalSummary,
  buildAwaitingUrlSummary,
  buildDynamicVerificationOfferSummary,
  buildStaticOnlySummary,
  skippedReasonLabel,
} from "./dynamic-verification-flow";
import { buildExecutiveSummaryLine } from "./finding-user-copy";
import type { ConsolidatedAuditFinding, FullProductAuditResult } from "./types";

type PublicAuditFinding = Omit<ConsolidatedAuditFinding, "adapterId" | "attackFindingId" | "technicalEvidence"> & {
  technicalEvidenceAvailable: boolean;
};

export type FullProductAuditMcpResponse = Omit<
  FullProductAuditResult,
  "reviewId" | "engines" | "dynamicVerification" | "findings" | "topRisks"
> & {
  source: "github";
  findings: PublicAuditFinding[];
  topRisks: PublicAuditFinding[];
  codeAnalysis: {
    findingsCount: number;
    rulesRun: number | null;
  };
  securityVerification: {
    offered: boolean;
    choice: "check_application" | "code_only" | null;
    application: string | null;
    awaitingApplicationUrl: boolean;
    awaitingConfirmation: boolean;
    checksRun: number;
    checksCompleted: number;
    notSafelyTestableCount: number;
    statusDetail: string | null;
  };
};

function publicFinding(finding: ConsolidatedAuditFinding): PublicAuditFinding {
  const {
    adapterId: _adapterId,
    attackFindingId: _attackFindingId,
    technicalEvidence,
    ...safe
  } = finding;
  return {
    ...safe,
    technicalEvidenceAvailable: Boolean(technicalEvidence?.items.length),
  };
}

function verificationLabel(status: string, t: McpTranslator): string {
  switch (status) {
    case "CONFIRMED":
      return t("fullProductAudit.verification.confirmed");
    case "LIKELY":
      return t("fullProductAudit.verification.likely");
    case "POTENTIAL":
      return t("fullProductAudit.verification.potential");
    case "NOT_REPRODUCED":
      return t("fullProductAudit.verification.notReproduced");
    case "FALSE_POSITIVE":
      return t("fullProductAudit.verification.falsePositive");
    case "NOT_APPLICABLE":
      return t("fullProductAudit.verification.notApplicable");
    case "UNVERIFIED":
      return t("fullProductAudit.verification.unverified");
    default:
      return status;
  }
}

function appendCheckedCategories(lines: string[], t: McpTranslator, result: FullProductAuditResult) {
  lines.push("", t("fullProductAudit.report.whatCheckedHeader"));
  const dynamicStatus =
    result.engines.securityTesting.executionsCompleted > 0
      ? t("fullProductAudit.report.checkCompleted")
      : result.engines.securityTesting.skippedReason
        ? t("fullProductAudit.report.checkBlocked")
        : t("fullProductAudit.report.checkNotTested");
  const categories = [
    [t("fullProductAudit.report.checkSourceCode"), t("fullProductAudit.report.checkCompleted")],
    [t("fullProductAudit.report.checkAuthentication"), t("fullProductAudit.report.checkCompleted")],
    [t("fullProductAudit.report.checkAuthorization"), t("fullProductAudit.report.checkCompleted")],
    [t("fullProductAudit.report.checkApiCoverage"), t("fullProductAudit.report.checkCompleted")],
    [t("fullProductAudit.report.checkCicd"), t("fullProductAudit.report.checkNotApplicable")],
    [t("fullProductAudit.report.checkSecurityConfig"), t("fullProductAudit.report.checkCompleted")],
    [t("fullProductAudit.report.checkDynamicTests"), dynamicStatus],
  ] as const;
  for (const [label, status] of categories) {
    lines.push(`✓ ${label}: ${status}`);
  }
}

function appendMainRisks(lines: string[], t: McpTranslator, risks: ConsolidatedAuditFinding[]) {
  if (risks.length === 0) return;
  lines.push("", t("fullProductAudit.report.mainRisksHeader"));
  for (const risk of risks) {
    lines.push("", `${risk.severity.toUpperCase()} — ${risk.title}`);
    lines.push(risk.userFacing?.simpleExplanation ?? risk.description);
    lines.push("", t("fullProductAudit.report.whyItMattersHeader"));
    lines.push(risk.userFacing?.whyItMatters ?? risk.description);
    lines.push("", t("fullProductAudit.report.whatWeFoundHeader"));
    if (risk.affectedComponent) {
      lines.push(`${t("fullProductAudit.report.fileLabel")}: ${risk.affectedComponent}`);
    }
    if (risk.line) {
      lines.push(`${t("fullProductAudit.report.lineLabel")}: ${risk.line}`);
    }
    lines.push("", t("fullProductAudit.report.confidenceHeader"));
    lines.push(risk.userFacing?.confidenceLabel ?? verificationLabel(risk.verificationStatus, t));
    lines.push("", t("fullProductAudit.report.dynamicVerificationHeader"));
    lines.push(
      `${risk.userFacing?.dynamicVerificationStatus ?? t("fullProductAudit.report.dynamicNotTested")}`
    );
    lines.push(
      `${t("fullProductAudit.report.reasonLabel")}: ${risk.userFacing?.dynamicVerificationReason ?? t("fullProductAudit.report.dynamicNotTestedReason")}`
    );
    lines.push("", t("fullProductAudit.report.whatToDoHeader"));
    lines.push(risk.userFacing?.whatToDo ?? risk.recommendation ?? t("fullProductAudit.report.reviewRequired"));
  }
}

function appendTestFixtures(lines: string[], t: McpTranslator, findings: ConsolidatedAuditFinding[]) {
  const fixtures = findings.filter((finding) => finding.userFacing?.safeToIgnore);
  if (fixtures.length === 0) return;
  lines.push("", t("fullProductAudit.report.testFixtureHeader"));
  for (const finding of fixtures) {
    lines.push("", t("fullProductAudit.report.testFixtureTitle"));
    lines.push(finding.userFacing?.simpleExplanation ?? finding.description);
    lines.push(t("fullProductAudit.report.testFixtureConclusion"));
  }
}

function appendStaticVsDynamic(lines: string[], t: McpTranslator) {
  lines.push("", t("fullProductAudit.report.staticVsDynamicHeader"));
  lines.push(t("fullProductAudit.report.staticAnalysisExplainer"));
  lines.push(t("fullProductAudit.report.dynamicVerificationExplainer"));
  lines.push(t("fullProductAudit.report.staticDynamicDistinction"));
}

function appendFinalVerdict(lines: string[], t: McpTranslator, result: FullProductAuditResult) {
  lines.push("", t("fullProductAudit.report.finalVerdictHeader"));
  lines.push(result.verdictStatus ? verdictHeadline(result.verdictStatus) : "IN PROGRESS");
  lines.push(buildExecutiveSummaryLine(result));
  lines.push("", t("fullProductAudit.report.whatWeKnowHeader"));
  lines.push(`✓ ${t("fullProductAudit.report.knownSourceAnalyzed")}`);
  if (result.dynamicVerification.authorizedTarget) {
    lines.push(`✓ ${t("fullProductAudit.report.knownApplicationAuthorized")}`);
  }
  if (result.engines.securityTesting.executionsCompleted > 0) {
    lines.push(`✓ ${t("fullProductAudit.report.knownDynamicExecuted")}`);
  }
  if (result.counts.confirmed === 0) {
    lines.push(`✓ ${t("fullProductAudit.report.knownNoConfirmedDynamic")}`);
  }
  lines.push("", t("fullProductAudit.report.whatWeDontKnowHeader"));
  if (result.counts.potential > 0) {
    lines.push(`⚠ ${t("fullProductAudit.report.unknownPotentialFindings")}`);
  } else {
    lines.push(`⚠ ${t("fullProductAudit.report.unknownLimitedDynamic")}`);
  }

  const hasSecretFindings = result.findings.some(
    (finding) =>
      finding.category?.toLowerCase().includes("secret") ||
      finding.title.toLowerCase().includes("secret") ||
      finding.title.toLowerCase().includes("credential")
  );
  const hasActionableRisks = result.topRisks.length > 0;

  if (hasActionableRisks || hasSecretFindings) {
    lines.push("", t("fullProductAudit.report.nextStepsHeader"));
    lines.push(`1. ${t("fullProductAudit.report.nextReviewValue")}`);
    if (hasSecretFindings) {
      lines.push(`2. ${t("fullProductAudit.report.nextRemoveSecret")}`);
      lines.push(`3. ${t("fullProductAudit.report.nextRotateSecret")}`);
      lines.push(`4. ${t("fullProductAudit.report.nextRerunAudit")}`);
    } else {
      lines.push(`2. ${t("fullProductAudit.report.nextRerunAudit")}`);
    }
  }
}

export function formatFullProductAuditResponse(
  result: FullProductAuditResult,
  t: McpTranslator
): FullProductAuditMcpResponse {
  const headline = result.verdictStatus ? verdictHeadline(result.verdictStatus) : "IN PROGRESS";
  const lines: string[] = [
    t("fullProductAudit.intro"),
    "",
    t("fullProductAudit.report.executiveSummaryHeader"),
    headline,
    "",
    buildExecutiveSummaryLine(result),
    "",
    t("fullProductAudit.securityScore", {
      score: result.score != null ? String(result.score) : t("fullProductAudit.scoreUnavailable"),
    }),
    "",
    t("fullProductAudit.severityCounts", {
      critical: String(result.counts.critical),
      high: String(result.counts.high),
      medium: String(result.counts.medium),
      low: String(result.counts.low),
    }),
    "",
    t("fullProductAudit.verificationCounts", {
      confirmed: String(result.counts.confirmed),
      likely: String(result.counts.likely),
      potential: String(result.counts.potential),
      notReproduced: String(result.counts.notReproduced),
    }),
  ];

  appendCheckedCategories(lines, t, result);
  appendMainRisks(lines, t, result.topRisks);
  appendTestFixtures(lines, t, result.findings);
  appendStaticVsDynamic(lines, t);

  lines.push("", t("fullProductAudit.dynamicTestingHeader"));
  if (result.dynamicVerification.decision === "static_only") {
    lines.push(buildStaticOnlySummary(t));
  } else if (result.dynamicVerification.awaitingScopeApproval) {
    lines.push(buildAwaitingScopeApprovalSummary(t));
  } else if (result.dynamicVerification.awaitingUrl) {
    lines.push(buildAwaitingUrlSummary(t));
  } else if (
    result.dynamicVerification.authorizedTarget &&
    result.engines.securityTesting.adaptersExecuted.length > 0
  ) {
    lines.push(
      t("fullProductAudit.dynamicTestingAuthorizedTarget", {
        target: result.dynamicVerification.authorizedTarget,
      }),
      t("fullProductAudit.report.dynamicExecutedSummary", {
        count: String(result.engines.securityTesting.executionsCompleted),
      }),
      result.counts.confirmed > 0
        ? t("fullProductAudit.report.dynamicConfirmedRisk")
        : t("fullProductAudit.report.dynamicNoConfirmedRisk")
    );
  } else if (result.engines.securityTesting.skippedReason) {
    lines.push(
      t("fullProductAudit.dynamicTestingNotExecuted"),
      skippedReasonLabel(result.engines.securityTesting.skippedReason, t)
    );
  } else if (result.engines.securityTesting.adaptersExecuted.length > 0) {
    lines.push(
      t("fullProductAudit.dynamicTestingSummary", {
        count: String(result.engines.securityTesting.adaptersExecuted.length),
        mode: "controlled",
      })
    );
  } else if (result.dynamicVerification.offered) {
    lines.push(t("fullProductAudit.dynamicTestingNotExecuted"));
  } else {
    lines.push(t("fullProductAudit.dynamicTestingSkippedNoTarget"));
  }

  if (result.whatToFixFirst.length > 0) {
    lines.push("", t("fullProductAudit.whatToFixFirstHeader"));
    for (const item of result.whatToFixFirst) {
      lines.push(`- ${item}`);
    }
  }

  appendFinalVerdict(lines, t, result);

  if (result.findings.some((finding) => finding.technicalEvidence?.items.length)) {
    lines.push("", t("fullProductAudit.report.technicalEvidenceHeader"));
    lines.push(t("fullProductAudit.report.technicalEvidenceHint"));
  }

  lines.push("", t("fullProductAudit.recommendationHeader"), result.recommendation);

  if (result.safeFixAvailable && result.safeFixBlockerId) {
    lines.push("", t("fullProductAudit.safeFixAvailable"));
  }

  if (result.dynamicVerification.offered) {
    lines.push("", buildDynamicVerificationOfferSummary(t, result.engines.codeReview.findingsCount));
  }

  if (result.timedOut) {
    lines.push("", t("fullProductAudit.timedOut"));
  }

  lines.push("", t("fullProductAudit.verifyFix"));

  const summary = buildTextResponse("full_product_audit" as never, t, lines);
  const {
    reviewId: _reviewId,
    engines: _engines,
    dynamicVerification: _dynamicVerification,
    findings: _findings,
    topRisks: _topRisks,
    ...publicResult
  } = result;
  return {
    ...publicResult,
    source: "github" as const,
    findings: result.findings.map(publicFinding),
    topRisks: result.topRisks.map(publicFinding),
    codeAnalysis: {
      findingsCount: result.engines.codeReview.findingsCount,
      rulesRun: result.engines.codeReview.rulesRun,
    },
    securityVerification: {
      offered: result.dynamicVerification.offered,
      choice:
        result.dynamicVerification.decision === "authorize"
          ? "check_application"
          : result.dynamicVerification.decision === "static_only"
            ? "code_only"
            : null,
      application: result.dynamicVerification.authorizedTarget,
      awaitingApplicationUrl: result.dynamicVerification.awaitingUrl,
      awaitingConfirmation:
        result.dynamicVerification.awaitingAuthorization ||
        result.dynamicVerification.awaitingScopeApproval,
      checksRun: result.engines.securityTesting.executionsRun,
      checksCompleted: result.engines.securityTesting.executionsCompleted,
      notSafelyTestableCount: result.engines.securityTesting.notSafelyTestableCount,
      statusDetail: result.engines.securityTesting.skippedReason
        ? skippedReasonLabel(result.engines.securityTesting.skippedReason, t)
        : null,
    },
    summary,
    nextAction: result.nextAction,
  };
}
