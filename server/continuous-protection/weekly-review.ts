import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { listDailyEligibleProjects } from "./daily-review";
import { appendCpEvent } from "./cp-memory-bridge";
import { confidenceTrendNarrative } from "./health-models";
import { getProtectionCenterModel, loadProtectionContext } from "./protection-context";
import { storageFromLabel } from "./types";

function startOfWeekUtc(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export type WeeklyReviewResult =
  | { outcome: "skipped"; reason: string }
  | { outcome: "completed"; weekStart: string };

export async function runWeeklyProtectionReview(
  admin: SupabaseClient,
  projectId: string
): Promise<WeeklyReviewResult> {
  const ctx = await loadProtectionContext(admin, projectId);
  if (!ctx) return { outcome: "skipped", reason: "project_not_found" };
  if (!ctx.cpEnabled || ctx.cpPaused) return { outcome: "skipped", reason: "cp_disabled" };
  if (!ctx.hasSuccessfulReview) return { outcome: "skipped", reason: "no_review_yet" };

  const weekStart = startOfWeekUtc();
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const { data: snapshots } = await admin
    .from("protection_snapshots")
    .select("*")
    .eq("project_id", projectId)
    .gte("snapshot_date", weekStart)
    .lte("snapshot_date", weekEndStr)
    .order("snapshot_date", { ascending: true });

  const rows = snapshots ?? [];
  const first = rows[0];
  const last = rows[rows.length - 1];

  const model = await getProtectionCenterModel(admin, projectId);
  const status = model?.status ?? "NOT_PROTECTED";
  const statusStorage = storageFromLabel(status);

  const prodStart = first?.production_confidence ?? null;
  const prodEnd = last?.production_confidence ?? ctx.productionConfidence;
  const secStart = first?.security_confidence ?? null;
  const secEnd = last?.security_confidence ?? ctx.securityConfidence;

  const prodDelta =
    prodStart != null && prodEnd != null ? prodEnd - prodStart : ctx.productionDelta7d;
  const secDelta =
    secStart != null && secEnd != null ? secEnd - secStart : ctx.securityDelta7d;

  const checksCompleted = rows.length;
  const trendNarrative = confidenceTrendNarrative(prodDelta, secDelta);

  const changes: string[] = [];
  if (prodDelta != null && prodDelta !== 0) {
    changes.push(
      prodDelta > 0
        ? `Production confidence improved by ${prodDelta} points.`
        : `Production confidence decreased by ${Math.abs(prodDelta)} points.`
    );
  }
  if (secDelta != null && secDelta !== 0) {
    changes.push(
      secDelta > 0
        ? `Security confidence improved by ${secDelta} points.`
        : `Security confidence decreased by ${Math.abs(secDelta)} points.`
    );
  }
  if (changes.length === 0) {
    changes.push("Quiet week — confidence held steady and nothing material changed.");
  }

  const worries = model?.worriesTop3 ?? [];
  const primaryRecommendation = model?.recommendation ?? "Ask SequrAI before your next deploy.";

  const narrative = [
    `YOUR APPLICATION IS: ${status.replace(/_/g, " ")}`,
    "",
    "This week at a glance",
    `• Production confidence: ${prodStart ?? "—"}% → ${prodEnd ?? "—"}%`,
    `• Security confidence: ${secStart ?? "—"}% → ${secEnd ?? "—"}%`,
    `• Protection checks completed: ${checksCompleted}/7`,
    "",
    trendNarrative,
    "",
    "What changed",
    ...changes.map((c) => `• ${c}`),
    "",
    "Things that worry me (still)",
    ...(worries.length ? worries.map((w) => `• ${w}`) : ["• Nothing urgent."]),
    "",
    "One thing to do next",
    `• ${primaryRecommendation}`,
  ].join("\n");

  const summary = {
    status,
    productionConfidence: { start: prodStart, end: prodEnd, delta: prodDelta },
    securityConfidence: { start: secStart, end: secEnd, delta: secDelta },
    checksCompleted,
    changes,
    worries,
    primaryRecommendation,
  };

  await admin.from("protection_weekly_summaries").upsert(
    {
      organization_id: ctx.organizationId,
      project_id: projectId,
      week_start: weekStart,
      status_at_end: statusStorage,
      summary,
      narrative,
      checks_completed: checksCompleted,
      production_confidence_start: prodStart,
      production_confidence_end: prodEnd,
      security_confidence_start: secStart,
      security_confidence_end: secEnd,
      primary_recommendation: primaryRecommendation,
    },
    { onConflict: "project_id,week_start" }
  );

  await appendCpEvent(admin, {
    organizationId: ctx.organizationId,
    projectId,
    type: "weekly_summary_generated",
    idempotencyKey: `weekly:${weekStart}`,
    payload: {
      weekStart,
      confidenceDelta: { production: prodDelta, security: secDelta },
      checksCompleted,
    },
  });

  await admin
    .from("project_continuous_protection")
    .update({
      last_weekly_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("project_id", projectId);

  return { outcome: "completed", weekStart };
}

export async function listWeeklyEligibleProjects(admin: SupabaseClient) {
  return listDailyEligibleProjects(admin);
}
