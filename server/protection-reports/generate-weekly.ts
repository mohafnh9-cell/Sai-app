import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFounderSummary } from "./founder-summary";
import { formatReportNarrative } from "./narrative";
import { loadReportSourceData, weekBoundsUtc } from "./report-data";
import { persistProtectionReport } from "./storage";
import { buildTimelineEntries, persistTimelineEntries } from "./timeline";
import type { StoredProtectionReport } from "./types";

export async function generateWeeklyProtectionReport(
  admin: SupabaseClient,
  projectId: string,
  options?: { regenerate?: boolean; referenceDate?: Date }
): Promise<StoredProtectionReport | { skipped: true; reason: string }> {
  const period = weekBoundsUtc(options?.referenceDate);
  const { organizationId, projectName, reportData, events } = await loadReportSourceData(
    admin,
    projectId,
    period
  );

  if (!reportData.protectionStatus.end && reportData.statistics.dailyChecksCompleted === 0) {
    return { skipped: true, reason: "insufficient_data" };
  }

  const founder = buildFounderSummary("weekly", reportData, projectName);
  const narrative = formatReportNarrative("weekly", projectName, period.start, reportData, founder);

  const report = await persistProtectionReport(admin, {
    organizationId,
    projectId,
    reportType: "weekly",
    periodStart: period.start,
    periodEnd: period.end,
    founderSummary: founder,
    reportData,
    narrative,
    regenerate: options?.regenerate,
  });

  const periodKey = `weekly:${period.start}`;
  const timeline = buildTimelineEntries("weekly", periodKey, reportData, founder, events);
  await persistTimelineEntries(admin, organizationId, projectId, periodKey, report.id, timeline);

  return report;
}

export async function listWeeklyReportEligibleProjects(admin: SupabaseClient) {
  const { data } = await admin
    .from("project_memory_profile")
    .select("project_id, organization_id")
    .not("first_protected_at", "is", null)
    .limit(500);
  return (data ?? []).map((r) => ({
    projectId: r.project_id as string,
    organizationId: r.organization_id as string,
  }));
}
