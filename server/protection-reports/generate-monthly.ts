import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFounderSummary } from "./founder-summary";
import { formatReportNarrative } from "./narrative";
import { loadReportSourceData, previousMonthBoundsUtc } from "./report-data";
import { persistProtectionReport } from "./storage";
import { buildTimelineEntries, persistTimelineEntries } from "./timeline";
import type { StoredProtectionReport } from "./types";
import { listWeeklyReportEligibleProjects } from "./generate-weekly";

export async function generateMonthlyProtectionReport(
  admin: SupabaseClient,
  projectId: string,
  options?: { regenerate?: boolean; referenceDate?: Date }
): Promise<StoredProtectionReport | { skipped: true; reason: string }> {
  const period = previousMonthBoundsUtc(options?.referenceDate);
  const { organizationId, projectName, reportData, events } = await loadReportSourceData(
    admin,
    projectId,
    period
  );

  if (reportData.statistics.dailyChecksCompleted === 0 && reportData.statistics.fullReviews === 0) {
    return { skipped: true, reason: "insufficient_data" };
  }

  const founder = buildFounderSummary("monthly", reportData, projectName);
  const narrative = formatReportNarrative("monthly", projectName, period.start, reportData, founder);

  const report = await persistProtectionReport(admin, {
    organizationId,
    projectId,
    reportType: "monthly",
    periodStart: period.start,
    periodEnd: period.end,
    founderSummary: founder,
    reportData,
    narrative,
    regenerate: options?.regenerate,
  });

  const periodKey = `monthly:${period.start.slice(0, 7)}`;
  const timeline = buildTimelineEntries("monthly", periodKey, reportData, founder, events);
  await persistTimelineEntries(admin, organizationId, projectId, periodKey, report.id, timeline);

  return report;
}

export async function listMonthlyReportEligibleProjects(admin: SupabaseClient) {
  return listWeeklyReportEligibleProjects(admin);
}
