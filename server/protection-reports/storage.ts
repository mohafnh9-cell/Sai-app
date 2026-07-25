import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FounderSummary, ProtectionReportData, ReportType, StoredProtectionReport } from "./types";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "protection-reports", event, ...fields });
}

export function reportDedupeKey(
  projectId: string,
  reportType: ReportType,
  periodStart: string
): string {
  return `${projectId}:${reportType}:${periodStart}`;
}

export async function appendMonthlyReportMemoryEvent(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    reportId: string;
    periodStart: string;
  }
): Promise<void> {
  const { error } = await admin.from("protection_events").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    type: "monthly_report_generated",
    idempotency_key: `monthly_report:${input.periodStart}`,
    payload: { reportId: input.reportId, periodStart: input.periodStart },
  });
  if (error && error.code !== "23505" && !error.message.includes("does not exist")) {
    log("monthly_memory_failed", { error: error.message });
  }
}

export async function persistProtectionReport(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    reportType: ReportType;
    periodStart: string;
    periodEnd: string;
    founderSummary: FounderSummary;
    reportData: ProtectionReportData;
    narrative: string;
    regenerate?: boolean;
  }
): Promise<StoredProtectionReport> {
  const dedupeKey = reportDedupeKey(input.projectId, input.reportType, input.periodStart);

  let version = 1;
  if (input.regenerate) {
    const { data: latest } = await admin
      .from("protection_reports")
      .select("version")
      .eq("project_id", input.projectId)
      .eq("dedupe_key", dedupeKey)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    version = ((latest?.version as number) ?? 0) + 1;
    await admin
      .from("protection_reports")
      .update({ is_current: false })
      .eq("project_id", input.projectId)
      .eq("dedupe_key", dedupeKey);
  }

  const { data: row, error } = await admin
    .from("protection_reports")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      report_type: input.reportType,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      version,
      is_current: true,
      dedupe_key: dedupeKey,
      founder_summary: input.founderSummary,
      report_data: input.reportData,
      narrative: input.narrative,
      regenerated_at: input.regenerate ? new Date().toISOString() : null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505" && !input.regenerate) {
      const { data: existing } = await admin
        .from("protection_reports")
        .select("*")
        .eq("project_id", input.projectId)
        .eq("dedupe_key", dedupeKey)
        .eq("is_current", true)
        .maybeSingle();
      if (existing) return mapReportRow(existing);
    }
    throw error;
  }

  if (input.reportType === "monthly") {
    await appendMonthlyReportMemoryEvent(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      reportId: row.id as string,
      periodStart: input.periodStart,
    });
  }

  return mapReportRow(row);
}

export function mapReportRow(row: Record<string, unknown>): StoredProtectionReport {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    organizationId: row.organization_id as string,
    reportType: row.report_type as ReportType,
    periodStart: row.period_start as string,
    periodEnd: row.period_end as string,
    version: row.version as number,
    isCurrent: row.is_current as boolean,
    dedupeKey: row.dedupe_key as string,
    founderSummary: row.founder_summary as FounderSummary,
    reportData: row.report_data as ProtectionReportData,
    narrative: row.narrative as string,
    generatedAt: row.generated_at as string,
    regeneratedAt: (row.regenerated_at as string) ?? null,
  };
}

export async function getCurrentReport(
  admin: SupabaseClient,
  projectId: string,
  reportType: ReportType,
  periodStart?: string
): Promise<StoredProtectionReport | null> {
  let query = admin
    .from("protection_reports")
    .select("*")
    .eq("project_id", projectId)
    .eq("report_type", reportType)
    .eq("is_current", true);

  if (periodStart) {
    query = query.eq("period_start", periodStart);
  }

  const { data } = await query.order("period_start", { ascending: false }).limit(1).maybeSingle();
  return data ? mapReportRow(data) : null;
}

export async function listReportHistory(
  admin: SupabaseClient,
  projectId: string,
  reportType?: ReportType,
  limit = 12
): Promise<StoredProtectionReport[]> {
  let query = admin
    .from("protection_reports")
    .select("*")
    .eq("project_id", projectId)
    .eq("is_current", true)
    .order("period_start", { ascending: false })
    .limit(limit);

  if (reportType) query = query.eq("report_type", reportType);

  const { data } = await query;
  return (data ?? []).map(mapReportRow);
}
