import type { FounderSummary, ProtectionReportData, ReportType } from "./types";

function fmtDelta(delta: number | null): string {
  if (delta == null || delta === 0) return "";
  return delta > 0 ? `(+${delta}%)` : `(${delta}%)`;
}

export function formatWeeklyReportNarrative(
  projectName: string,
  periodStart: string,
  data: ProtectionReportData,
  founder: FounderSummary
): string {
  return [
    "YOUR WEEK WITH SEQURAI",
    `${projectName} · Week of ${periodStart}`,
    "",
    "────────────────────────────────────────",
    "PROTECTION SUMMARY",
    "────────────────────────────────────────",
    "",
    `Your application is: ${data.protectionStatus.endLabel}`,
    "",
    founder.moreProtectedNarrative,
    "",
    "────────────────────────────────────────",
    "CONFIDENCE THIS WEEK",
    "────────────────────────────────────────",
    "",
    `Production: ${data.productionConfidence.start ?? "—"}% → ${data.productionConfidence.end ?? "—"}% ${fmtDelta(data.productionConfidence.delta)}`,
    `Security:   ${data.securityConfidence.start ?? "—"}% → ${data.securityConfidence.end ?? "—"}% ${fmtDelta(data.securityConfidence.delta)}`,
    "",
    "────────────────────────────────────────",
    "WHAT IMPROVED",
    "────────────────────────────────────────",
    "",
    ...founder.whatImproved.map((l) => `• ${l}`),
    "",
    "────────────────────────────────────────",
    "WHAT CHANGED",
    "────────────────────────────────────────",
    "",
    ...(data.whatBecameWorse.length ? data.whatBecameWorse : ["• No material regressions this week."]).map(
      (l) => (l.startsWith("•") ? l : `• ${l}`)
    ),
    "",
    "────────────────────────────────────────",
    "WHAT WORRIES SEQURAI",
    "────────────────────────────────────────",
    "",
    ...founder.whatWorriesSequrAI.map((w) => `• ${w}`),
    "",
    "────────────────────────────────────────",
    "WHAT TO DO NEXT",
    "────────────────────────────────────────",
    "",
    founder.whatToDoNext,
    "",
    `Checks completed: ${data.statistics.dailyChecksCompleted}/7`,
    "",
    founder.wouldDeployToday,
  ].join("\n");
}

export function formatMonthlyReportNarrative(
  projectName: string,
  periodStart: string,
  data: ProtectionReportData,
  founder: FounderSummary
): string {
  const monthLabel = periodStart.slice(0, 7);
  return [
    "SEQURAI MONTHLY PROTECTION REPORT",
    `${projectName} · ${monthLabel}`,
    "",
    "────────────────────────────────────────",
    "YOUR PROTECTION THIS MONTH",
    "────────────────────────────────────────",
    "",
    `Your application is: ${data.protectionStatus.endLabel}`,
    "",
    founder.moreProtectedNarrative,
    "",
    "────────────────────────────────────────",
    "CONFIDENCE",
    "────────────────────────────────────────",
    "",
    `Production confidence: ${data.productionConfidence.start ?? "—"}% → ${data.productionConfidence.end ?? "—"}% ${fmtDelta(data.productionConfidence.delta)}`,
    `Security confidence:   ${data.securityConfidence.start ?? "—"}% → ${data.securityConfidence.end ?? "—"}% ${fmtDelta(data.securityConfidence.delta)}`,
    "",
    "────────────────────────────────────────",
    "PROTECTION STATISTICS",
    "────────────────────────────────────────",
    "",
    `Daily protection checks completed: ${data.statistics.dailyChecksCompleted} / ${data.statistics.daysInPeriod}`,
    `Full protection reviews:               ${data.statistics.fullReviews}`,
    `Times SequrAI reached out (important): ${data.statistics.alertsImportant}`,
    `Unsafe deployments prevented:          ${data.statistics.unsafeDeploymentsPrevented}`,
    `Critical issues addressed:             ${data.statistics.criticalIssuesFixed}`,
    `Safe Fixes applied:                    ${data.statistics.safeFixesApplied}`,
    `Recommendations completed:             ${data.statistics.recommendationsCompleted}`,
    "",
    "────────────────────────────────────────",
    "WHAT IMPROVED",
    "────────────────────────────────────────",
    "",
    ...founder.whatImproved.map((l) => `• ${l}`),
    "",
    "────────────────────────────────────────",
    "WHAT WORRIES SEQURAI",
    "────────────────────────────────────────",
    "",
    ...founder.whatWorriesSequrAI.map((w) => `• ${w}`),
    "",
    "────────────────────────────────────────",
    "WHAT TO DO NEXT",
    "────────────────────────────────────────",
    "",
    `Recommendation:\n${founder.whatToDoNext}`,
    "",
    founder.wouldDeployToday,
    "",
    `Continuous protection was ${data.continuousProtectionOn ? "ON" : "OFF"} this month.`,
    "",
    "SequrAI — Your Production & Protection Engineer.",
  ].join("\n");
}

export function formatReportNarrative(
  reportType: ReportType,
  projectName: string,
  periodStart: string,
  data: ProtectionReportData,
  founder: FounderSummary
): string {
  return reportType === "weekly"
    ? formatWeeklyReportNarrative(projectName, periodStart, data, founder)
    : formatMonthlyReportNarrative(projectName, periodStart, data, founder);
}
