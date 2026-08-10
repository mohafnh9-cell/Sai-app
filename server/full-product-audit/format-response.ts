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
import type { ConsolidatedAuditFinding, FullProductAuditResult } from "./types";

type PublicAuditFinding = Omit<ConsolidatedAuditFinding, "adapterId" | "attackFindingId">;

export type FullProductAuditMcpResponse = Omit<
  FullProductAuditResult,
  "reviewId" | "engines" | "dynamicVerification" | "findings" | "topRisks"
> & {
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
  const { adapterId: _adapterId, attackFindingId: _attackFindingId, ...safe } = finding;
  return safe;
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

export function formatFullProductAuditResponse(
  result: FullProductAuditResult,
  t: McpTranslator
): FullProductAuditMcpResponse {
  const headline = result.verdictStatus ? verdictHeadline(result.verdictStatus) : "IN PROGRESS";
  const lines: string[] = [
    t("fullProductAudit.intro"),
    "",
    t("fullProductAudit.productionReadiness"),
    headline,
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

  if (result.dynamicVerification.offered) {
    lines.push("", buildDynamicVerificationOfferSummary(t, result.engines.codeReview.findingsCount));
  }

  if (result.topRisks.length > 0) {
    lines.push("", t("fullProductAudit.topRisksHeader"));
    for (const [index, risk] of result.topRisks.entries()) {
      lines.push(
        `${index + 1}. ${risk.severity.toUpperCase()} — ${risk.title}`,
        `   ${verificationLabel(risk.verificationStatus, t)}`,
        risk.affectedComponent ? `   ${t("fullProductAudit.component")}: ${risk.affectedComponent}` : ""
      );
    }
  }

  if (result.whatToFixFirst.length > 0) {
    lines.push("", t("fullProductAudit.whatToFixFirstHeader"));
    for (const item of result.whatToFixFirst) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("", t("fullProductAudit.recommendationHeader"), result.recommendation);

  if (result.safeFixAvailable && result.safeFixBlockerId) {
    lines.push("", t("fullProductAudit.safeFixAvailable"));
  }

  lines.push(
    "",
    t("fullProductAudit.staticAnalysisHeader"),
    t("fullProductAudit.staticAnalysisSummary", {
      count: String(result.engines.codeReview.findingsCount),
    }),
    t("fullProductAudit.staticAnalysisComplete")
  );

  lines.push("", t("fullProductAudit.dynamicTestingHeader"));

  if (result.dynamicVerification.decision === "static_only") {
    lines.push(buildStaticOnlySummary(t));
  } else if (result.dynamicVerification.awaitingScopeApproval) {
    lines.push(buildAwaitingScopeApprovalSummary(t));
  } else if (result.dynamicVerification.awaitingUrl) {
    lines.push(buildAwaitingUrlSummary(t));
  } else if (result.dynamicVerification.authorizedTarget && result.engines.securityTesting.adaptersExecuted.length > 0) {
    lines.push(
      t("fullProductAudit.dynamicTestingAuthorizedTarget", {
        target: result.dynamicVerification.authorizedTarget,
      }),
      t("fullProductAudit.dynamicTestingSummary", {
        count: String(result.engines.securityTesting.adaptersExecuted.length),
        mode: "controlled",
      })
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

  if (result.engines.securityTesting.notSafelyTestableCount > 0) {
    lines.push(
      t("fullProductAudit.dynamicTestingPartial", {
        count: String(result.engines.securityTesting.notSafelyTestableCount),
      })
    );
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
