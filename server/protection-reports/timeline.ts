import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimelineEntry } from "./types";
import type { ProtectionReportData } from "./types";
import type { FounderSummary } from "./types";
import type { ReportType } from "./types";

export function buildTimelineEntries(
  reportType: ReportType,
  periodKey: string,
  data: ProtectionReportData,
  founder: FounderSummary,
  events: Array<{ type: string; payload: Record<string, unknown>; occurred_at: string }>
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  entries.push({
    occurredAt: new Date().toISOString(),
    episodeKind: reportType === "weekly" ? "weekly_milestone" : "monthly_milestone",
    periodKey,
    icon: "watch",
    titlePlain:
      reportType === "weekly"
        ? `Weekly protection summary — ${data.protectionStatus.endLabel}`
        : `Monthly protection report — ${data.protectionStatus.endLabel}`,
    subtitlePlain: founder.moreProtectedNarrative,
  });

  if (data.productionConfidence.delta != null && data.productionConfidence.delta !== 0) {
    entries.push({
      occurredAt: new Date().toISOString(),
      episodeKind: "confidence_change",
      periodKey,
      icon: "confidence",
      titlePlain: "Production confidence shifted",
      subtitlePlain: `${data.productionConfidence.start ?? "—"}% → ${data.productionConfidence.end ?? "—"}%`,
    });
  }

  for (const line of founder.whatImproved.slice(0, 3)) {
    entries.push({
      occurredAt: new Date().toISOString(),
      episodeKind: "protection_improvement",
      periodKey,
      icon: "fix",
      titlePlain: line.replace(/^Fixed: /, "Fix verified: "),
      subtitlePlain: "",
    });
  }

  const importantTypes = new Set([
    "material_change_detected",
    "deploy_blocked",
    "fix_verified",
    "protection_status_updated",
    "alert_sent",
  ]);

  for (const e of events.filter((x) => importantTypes.has(x.type)).slice(-8)) {
    entries.push({
      occurredAt: e.occurred_at,
      episodeKind: "important_event",
      periodKey,
      icon: e.type === "deploy_blocked" ? "deploy" : "alert",
      titlePlain: humanEventTitle(e.type, e.payload),
      subtitlePlain: "",
      payload: e.payload,
    });
  }

  return entries;
}

function humanEventTitle(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "deploy_blocked":
      return "Unsafe deployment prevented";
    case "fix_verified":
      return `Fix verified${payload.titlePlain ? `: ${payload.titlePlain}` : ""}`;
    case "material_change_detected":
      return "Material change detected";
    case "protection_status_updated":
      return "Protection status updated";
    case "alert_sent":
      return "SequrAI reached out — something mattered";
    default:
      return type.replace(/_/g, " ");
  }
}

export async function persistTimelineEntries(
  admin: SupabaseClient,
  organizationId: string,
  projectId: string,
  periodKey: string,
  reportId: string,
  entries: TimelineEntry[]
): Promise<void> {
  await admin
    .from("protection_timeline_entries")
    .delete()
    .eq("project_id", projectId)
    .eq("period_key", periodKey);

  if (!entries.length) return;

  await admin.from("protection_timeline_entries").insert(
    entries.map((e) => ({
      organization_id: organizationId,
      project_id: projectId,
      occurred_at: e.occurredAt,
      episode_kind: e.episodeKind,
      period_key: periodKey,
      icon: e.icon,
      title_plain: e.titlePlain,
      subtitle_plain: e.subtitlePlain,
      payload: e.payload ?? {},
      source_report_id: reportId,
    }))
  );
}
