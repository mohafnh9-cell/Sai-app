import type { FounderSummary, ProtectionReportData, ReportType } from "./types";

function trendWord(delta: number | null): string {
  if (delta == null || delta === 0) return "held steady";
  return delta > 0 ? "improved" : "softened";
}

export function buildFounderSummary(
  reportType: ReportType,
  data: ProtectionReportData,
  projectName: string
): FounderSummary {
  const prior = reportType === "weekly" ? "last week" : "last month";
  const prod = data.productionConfidence.delta;
  const sec = data.securityConfidence.delta;
  const statusImproved =
    data.protectionStatus.start != null &&
    data.protectionStatus.end != null &&
    rankStatus(data.protectionStatus.end) < rankStatus(data.protectionStatus.start);

  const moreProtected =
    statusImproved ||
    (prod != null && prod > 0) ||
    (sec != null && sec > 0) ||
    (data.whatBecameWorse.length === 0 && data.statistics.dailyChecksCompleted > 0);

  const moreProtectedNarrative = moreProtected
    ? `Yes — compared to ${prior}, ${projectName} is in a stronger protection posture. Production confidence ${trendWord(prod)} and security confidence ${trendWord(sec)}.`
    : `Honest answer: compared to ${prior}, a few things need attention — but SequrAI kept watching every day.`;

  const worries =
    data.topPriorities.length > 0
      ? data.topPriorities.slice(0, 3)
      : ["Nothing urgent — keep building and ask before you deploy."];

  const whatToDoNext =
    data.openRecommendations[0] != null
      ? `Apply Safe Fix for: ${data.openRecommendations[0]}`
      : data.protectionStatus.endLabel === "PROTECTED"
        ? "Keep building — ask SequrAI before your next deploy."
        : "Run a fresh protection review, then apply Safe Fix if needed.";

  const wouldDeployToday =
    data.protectionStatus.endLabel === "PROTECTED" && worries.length === 1 && worries[0].includes("Nothing urgent")
      ? "If this were my company, I would deploy today."
      : data.protectionStatus.endLabel === "PROTECTED"
        ? "If this were my company, I would deploy after addressing the recommendation above."
        : "If this were my company, I would not deploy until we clear what worries me most.";

  return {
    moreProtectedThanPriorPeriod: moreProtected,
    moreProtectedNarrative,
    whatImproved: data.whatImproved.slice(0, 5),
    whatWorriesSequrAI: worries,
    whatToDoNext,
    wouldDeployToday,
  };
}

function rankStatus(value: string | null): number {
  switch (value) {
    case "protected":
      return 0;
    case "safe_with_caution":
      return 1;
    case "requires_attention":
      return 2;
    default:
      return 3;
  }
}
