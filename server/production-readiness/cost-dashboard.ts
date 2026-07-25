import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type CostDashboardSnapshot = {
  periodHours: number;
  reviewsStarted: number;
  reviewsCompleted: number;
  safeFixesGenerated: number;
  reportsGenerated: number;
  alertsGenerated: number;
  estimatedReviewCostUsd: number;
  estimatedSafeFixCostUsd: number;
  estimatedReportCostUsd: number;
  estimatedTotalCostUsd: number;
  avgCostPerProjectUsd: number | null;
  avgCostPerOrganizationUsd: number | null;
  assumptions: Record<string, string>;
  generatedAt: string;
};

const REVIEW_COST_USD = Number(process.env.SEQURAI_COST_REVIEW_USD ?? "0.35");
const SAFE_FIX_COST_USD = Number(process.env.SEQURAI_COST_SAFE_FIX_USD ?? "0.08");
const REPORT_COST_USD = Number(process.env.SEQURAI_COST_REPORT_USD ?? "0.02");

export async function buildCostDashboard(
  admin: SupabaseClient,
  periodHours = 24
): Promise<CostDashboardSnapshot> {
  const since = new Date(Date.now() - periodHours * 60 * 60 * 1000).toISOString();

  const [reviewsStarted, reviewsCompleted, safeFixes, reports, alerts, projects, orgs] =
    await Promise.all([
      admin
        .from("scan_job_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "job_started")
        .gte("created_at", since),
      admin
        .from("scan_job_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "job_completed")
        .gte("created_at", since),
      admin
        .from("safe_fix_records")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      admin
        .from("protection_reports")
        .select("id", { count: "exact", head: true })
        .gte("generated_at", since),
      admin
        .from("security_alerts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      admin.from("projects").select("id", { count: "exact", head: true }),
      admin.from("organizations").select("id", { count: "exact", head: true }),
    ]);

  const reviewStartCount = reviewsStarted.count ?? 0;
  const reviewCompleteCount = reviewsCompleted.count ?? 0;
  const safeFixCount = safeFixes.count ?? 0;
  const reportCount = reports.count ?? 0;

  const estimatedReviewCostUsd = reviewCompleteCount * REVIEW_COST_USD;
  const estimatedSafeFixCostUsd = safeFixCount * SAFE_FIX_COST_USD;
  const estimatedReportCostUsd = reportCount * REPORT_COST_USD;
  const estimatedTotalCostUsd =
    estimatedReviewCostUsd + estimatedSafeFixCostUsd + estimatedReportCostUsd;

  const projectCount = projects.count ?? 0;
  const orgCount = orgs.count ?? 0;

  return {
    periodHours,
    reviewsStarted: reviewStartCount,
    reviewsCompleted: reviewCompleteCount,
    safeFixesGenerated: safeFixCount,
    reportsGenerated: reportCount,
    alertsGenerated: alerts.count ?? 0,
    estimatedReviewCostUsd,
    estimatedSafeFixCostUsd,
    estimatedReportCostUsd,
    estimatedTotalCostUsd,
    avgCostPerProjectUsd: projectCount ? estimatedTotalCostUsd / projectCount : null,
    avgCostPerOrganizationUsd: orgCount ? estimatedTotalCostUsd / orgCount : null,
    assumptions: {
      reviewUsd: String(REVIEW_COST_USD),
      safeFixUsd: String(SAFE_FIX_COST_USD),
      reportUsd: String(REPORT_COST_USD),
      note: "Internal estimate — configure SEQURAI_COST_* env vars from provider bills.",
    },
    generatedAt: new Date().toISOString(),
  };
}
