import { getMitigationTemplate } from "@/server/attack-simulation/mitigation/evaluate-outcome";
import type { ConsolidatedAuditFinding } from "./types";

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
    default:
      return 1;
  }
}

export function enrichAuditFindingSolutions(
  findings: ConsolidatedAuditFinding[]
): ConsolidatedAuditFinding[] {
  return findings.map((finding) => {
    if (severityRank(finding.severity) < 3 && finding.verificationStatus === "NOT_APPLICABLE") {
      return finding;
    }

    const template = finding.adapterId ? getMitigationTemplate(finding.adapterId) : null;
    const attackPerformed =
      finding.source === "both" || finding.source === "security_test"
        ? finding.evidence.find((line) => line.startsWith("Dynamic"))
        : null;

    const solution = {
      whatIsWrong: finding.title,
      whyItMatters:
        finding.description ||
        "This weakness can expose user data, enable abuse, or allow unauthorized access in production.",
      rootCause: template?.rootCause ?? finding.recommendation,
      recommendedFix:
        finding.recommendation ??
        template?.recommendedProtection ??
        "Add server-side validation and authorization at the affected boundary.",
      affectedFiles: finding.affectedComponent ? [finding.affectedComponent] : template?.likelyAffectedFiles ?? [],
      codeRecommendation: template?.implementationSteps.join(" ") ?? finding.recommendation,
      verificationProcedure:
        finding.verificationStatus === "CONFIRMED" || finding.verificationStatus === "LIKELY"
          ? "Re-run Full Product Audit after applying the fix; the related attack should no longer confirm."
          : "Re-run Full Product Audit after applying the fix; static finding should disappear or downgrade.",
      attackPerformed: attackPerformed ?? null,
    };

    return { ...finding, solution };
  });
}
