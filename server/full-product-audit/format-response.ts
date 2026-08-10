import "server-only";

import { verdictHeadline } from "@/brain/production-verdict/status-rules";
import type { McpTranslator } from "@/server/mcp/i18n";
import { buildTextResponse } from "@/server/mcp/response-format";
import type { FullProductAuditResult } from "./types";

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
): FullProductAuditResult {
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
    })
  );

  lines.push("", t("fullProductAudit.dynamicTestingHeader"));
  if (
    result.engines.securityTesting.runtimeMode === "mock" &&
    result.engines.securityTesting.dynamicTargetSource === "none"
  ) {
    lines.push(t("fullProductAudit.dynamicTestingSkippedNoTarget"));
  } else if (result.engines.securityTesting.skippedReason) {
    lines.push(
      "",
      t("fullProductAudit.securityTestsSkipped", {
        reason: result.engines.securityTesting.skippedReason,
      })
    );
  } else if (result.engines.securityTesting.adaptersExecuted.length > 0) {
    lines.push(
      t("fullProductAudit.dynamicTestingSummary", {
        count: String(result.engines.securityTesting.adaptersExecuted.length),
        mode: result.engines.securityTesting.runtimeMode ?? "mock",
      })
    );
  } else {
    lines.push(t("fullProductAudit.dynamicTestingSkippedNoTarget"));
  }

  if (result.timedOut) {
    lines.push("", t("fullProductAudit.timedOut"));
  }

  lines.push("", t("fullProductAudit.verifyFix"));

  const summary = buildTextResponse("full_product_audit" as never, t, lines);
  return { ...result, summary, nextAction: result.nextAction };
}
