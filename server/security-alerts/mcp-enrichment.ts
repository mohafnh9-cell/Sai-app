import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sortAlertsByPriority } from "./noise-policy";
import { mapAlertRow } from "./lifecycle";
import { getOpenAlertsForProject } from "./evaluate-project";
import type { FounderAlertRecord } from "./types";
import { severityProfile } from "./severity";

type McpEnrichable = {
  summary?: string;
  project?: { id?: string; name?: string };
  nextAction?: string;
};

export type McpAlertSurface = {
  shouldWorry: boolean;
  protectionStatus: string | null;
  openAlerts: FounderAlertRecord[];
  primaryAlert: FounderAlertRecord | null;
  founderGuidance: {
    whatHappened: string;
    whyItMatters: string;
    howSerious: string;
    whatToDoNext: string;
  } | null;
};

export async function loadMcpAlertSurface(
  admin: SupabaseClient,
  projectId: string
): Promise<McpAlertSurface> {
  const rows = await getOpenAlertsForProject(admin, projectId, 5);
  const openAlerts = sortAlertsByPriority(
    rows.map(mapAlertRow).map((a) => ({ ...a, priority: severityProfile(a.severity).priority }))
  );
  const primary = openAlerts.find((a) => a.severity === "critical") ?? openAlerts[0] ?? null;

  const shouldWorry = Boolean(primary && (primary.severity === "critical" || primary.severity === "high"));

  return {
    shouldWorry,
    protectionStatus: null,
    openAlerts,
    primaryAlert: primary,
    founderGuidance: primary
      ? {
          whatHappened: primary.changedBullets.join("; ") || primary.titlePlain,
          whyItMatters: primary.protectionImpact,
          howSerious: primary.worryLine,
          whatToDoNext: primary.nextAction,
        }
      : null,
  };
}

function alertOpeningBlock(alert: FounderAlertRecord): string {
  return [
    alert.severity === "critical" ? "Yes — something needs attention." : "Yes — I'd look at this before your next deploy.",
    "",
    "I'm worried about:",
    ...alert.changedBullets.slice(0, 3).map((b) => `• ${b}`),
    "",
    "This showed up during today's protection check.",
    "",
    "Recommended action:",
    alert.nextAction,
  ].join("\n");
}

/** Sprint 5 MCP layer — enriches existing tool payloads without new tools. */
export async function enrichMcpToolResultWithAlerts(
  admin: SupabaseClient,
  toolName: string,
  result: McpEnrichable
): Promise<McpEnrichable & { alerts?: McpAlertSurface }> {
  const projectId = result.project?.id;
  if (!projectId) return result;

  const surface = await loadMcpAlertSurface(admin, projectId);

  if (toolName === "can_i_deploy") {
    let summary = result.summary ?? "";
    if (surface.primaryAlert && (surface.primaryAlert.severity === "critical" || surface.primaryAlert.severity === "high")) {
      const unread = surface.openAlerts.some((a) => !a.readAt);
      if (unread) {
        summary = `${alertOpeningBlock(surface.primaryAlert)}\n\n${summary}`;
      }
    } else if (!surface.shouldWorry && summary.length > 0) {
      summary = `No — nothing urgent.\n\n${summary}`;
    }
    return { ...result, summary, alerts: surface };
  }

  if (toolName === "what_changed") {
    let summary = result.summary ?? "";
    if (surface.primaryAlert) {
      const bullets = surface.primaryAlert.changedBullets.slice(0, 3).map((b) => `• ${b}`).join("\n");
      summary = `${summary}\n\nThis is why I alerted you:\n${bullets}`;
    }
    return { ...result, summary, alerts: surface };
  }

  if (toolName === "production_history") {
    const count = surface.openAlerts.length;
    if (count > 0) {
      const summary = result.summary ?? "";
      return {
        ...result,
        summary: `${summary}\n\nThis period I reached out ${count} time${count === 1 ? "" : "s"} — only when something mattered.`,
        alerts: surface,
      };
    }
  }

  return { ...result, alerts: surface.openAlerts.length ? surface : undefined };
}
