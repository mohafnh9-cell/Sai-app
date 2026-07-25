import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { labelFromStorage, type ProtectionStatusStorage } from "@/server/continuous-protection/types";
import { getProtectionCenterModel } from "@/server/continuous-protection/protection-context";
import type { ProtectionReportData } from "./types";

export type PeriodBounds = { start: string; end: string; days: number };

export function weekBoundsUtc(date = new Date()): PeriodBounds {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  const start = d.toISOString().slice(0, 10);
  const endDate = new Date(d);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  const end = endDate.toISOString().slice(0, 10);
  return { start, end, days: 7 };
}

export function monthBoundsUtc(date = new Date()): PeriodBounds {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(y, m + 1, 0));
  const end = endDate.toISOString().slice(0, 10);
  return { start, end, days: endDate.getUTCDate() };
}

export function previousMonthBoundsUtc(date = new Date()): PeriodBounds {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return monthBoundsUtc(d);
}

function statusLabel(value: string | null): string {
  if (!value) return "NOT PROTECTED";
  return labelFromStorage(value as ProtectionStatusStorage);
}

function delta(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return b - a;
}

/** Read-only aggregation from Memory, CP, Alerts — no duplicate stores. */
export async function loadReportSourceData(
  admin: SupabaseClient,
  projectId: string,
  period: PeriodBounds
): Promise<{
  organizationId: string;
  projectName: string;
  reportData: ProtectionReportData;
  events: Array<{ type: string; payload: Record<string, unknown>; occurred_at: string }>;
}> {
  const { data: project } = await admin
    .from("projects")
    .select("name, organization_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) throw new Error("project_not_found");

  const organizationId = project.organization_id as string;
  const periodStartIso = `${period.start}T00:00:00.000Z`;
  const periodEndIso = `${period.end}T23:59:59.999Z`;

  const [snapshots, events, recommendations, milestones, cpRow, center] = await Promise.all([
    admin
      .from("protection_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .gte("snapshot_date", period.start)
      .lte("snapshot_date", period.end)
      .order("snapshot_date", { ascending: true }),
    admin
      .from("protection_events")
      .select("type, payload, occurred_at")
      .eq("project_id", projectId)
      .gte("occurred_at", periodStartIso)
      .lte("occurred_at", periodEndIso)
      .order("occurred_at", { ascending: true }),
    admin
      .from("protection_recommendations")
      .select("title_plain, status, severity")
      .eq("project_id", projectId)
      .eq("status", "open")
      .limit(10),
    admin
      .from("protection_milestones")
      .select("milestone_type, achieved_at")
      .eq("project_id", projectId)
      .gte("achieved_at", periodStartIso)
      .lte("achieved_at", periodEndIso),
    admin.from("project_continuous_protection").select("enabled, paused_at").eq("project_id", projectId).maybeSingle(),
    getProtectionCenterModel(admin, projectId),
  ]);

  const snapRows = snapshots.data ?? [];
  const firstSnap = snapRows[0];
  const lastSnap = snapRows[snapRows.length - 1];

  const ev = (events.data ?? []).map((e) => ({
    type: e.type as string,
    payload: (e.payload as Record<string, unknown>) ?? {},
    occurred_at: e.occurred_at as string,
  }));

  const dailyChecks = ev.filter((e) => e.type === "continuous_check_completed").length;
  const fullReviews = ev.filter(
    (e) => e.type === "protection_review_completed" || e.type === "verdict_created"
  ).length;
  const alertsImportant = ev.filter((e) => {
    if (e.type !== "alert_sent") return false;
    const sev = e.payload.severity as string | undefined;
    return sev === "critical" || sev === "high" || sev === "urgent" || sev === "important";
  }).length;
  const unsafeDeploymentsPrevented =
    ev.filter((e) => e.type === "deploy_blocked").length +
    ev.filter((e) => e.type === "alert_sent" && e.payload.alertKind === "deploy_blocked").length;
  const criticalIssuesFixed = ev.filter(
    (e) => e.type === "fix_verified" && (e.payload.severity === "critical" || e.payload.severity === "high")
  ).length;
  const safeFixesApplied = ev.filter((e) => e.type === "safe_fix_generated").length;
  const recommendationsCompleted = ev.filter(
    (e) => e.type === "fix_verified" || (e.payload.status === "verified" && e.type === "recommendation_dismissed")
  ).length;

  const prodStart = firstSnap?.production_confidence ?? null;
  const prodEnd = lastSnap?.production_confidence ?? center?.productionConfidence ?? null;
  const secStart = firstSnap?.security_confidence ?? null;
  const secEnd = lastSnap?.security_confidence ?? center?.securityConfidence ?? null;

  const whatImproved: string[] = [];
  const whatBecameWorse: string[] = [];

  if (prodEnd != null && prodStart != null && prodEnd > prodStart) {
    whatImproved.push(`Production confidence ${prodStart}% → ${prodEnd}%.`);
  }
  if (secEnd != null && secStart != null && secEnd > secStart) {
    whatImproved.push(`Security confidence ${secStart}% → ${secEnd}%.`);
  }
  if (prodEnd != null && prodStart != null && prodEnd < prodStart) {
    whatBecameWorse.push(`Production confidence ${prodStart}% → ${prodEnd}%.`);
  }
  if (secEnd != null && secStart != null && secEnd < secStart) {
    whatBecameWorse.push(`Security confidence ${secStart}% → ${secEnd}%.`);
  }

  for (const e of ev.filter((x) => x.type === "fix_verified").slice(-5)) {
    const title = e.payload.titlePlain as string | undefined;
    if (title) whatImproved.push(`Fixed: ${title}`);
  }

  for (const e of ev.filter((x) => x.type === "material_change_detected").slice(-3)) {
    whatBecameWorse.push("Material change detected on the default branch.");
  }

  if (whatImproved.length === 0 && whatBecameWorse.length === 0) {
    whatImproved.push("Quiet period — daily protection checks kept watch with no regressions.");
  }

  const openRecommendations = (recommendations.data ?? []).map((r) => r.title_plain as string);
  const topPriorities = center?.worriesTop3 ?? openRecommendations.slice(0, 3);

  const milestoneLines = (milestones.data ?? []).map(
    (m) => `Milestone: ${(m.milestone_type as string).replace(/_/g, " ")}`
  );

  const statusStart = firstSnap?.protection_status as string | null;
  const statusEnd = (lastSnap?.protection_status as string | null) ?? null;

  const cpOn = Boolean(cpRow.data?.enabled && !cpRow.data?.paused_at);

  const reportData: ProtectionReportData = {
    protectionStatus: {
      start: statusStart,
      end: statusEnd,
      endLabel: center?.status ?? statusLabel(statusEnd),
    },
    productionConfidence: { start: prodStart, end: prodEnd, delta: delta(prodStart, prodEnd) },
    securityConfidence: { start: secStart, end: secEnd, delta: delta(secStart, secEnd) },
    whatImproved,
    whatBecameWorse,
    openRecommendations,
    topPriorities,
    statistics: {
      dailyChecksCompleted: dailyChecks,
      fullReviews,
      alertsImportant,
      unsafeDeploymentsPrevented,
      criticalIssuesFixed,
      safeFixesApplied,
      recommendationsCompleted,
      daysInPeriod: period.days,
    },
    milestones: milestoneLines,
    projectEvolution: [
      `Status at period end: ${statusLabel(statusEnd)}`,
      ...(prodEnd != null ? [`Production confidence: ${prodEnd}%`] : []),
    ],
    continuousProtectionOn: cpOn,
  };

  return {
    organizationId,
    projectName: project.name as string,
    reportData,
    events: ev,
  };
}
