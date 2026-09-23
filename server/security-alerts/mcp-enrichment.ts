import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sortAlertsByPriority } from "./noise-policy";
import { mapAlertRow } from "./lifecycle";
import { isHistoricalAlert } from "./deploy-alert-decision";
import { getOpenAlertsForProject } from "./evaluate-project";
import type { FounderAlertRecord } from "./types";
import { severityProfile } from "./severity";

type McpEnrichable = {
  summary?: string;
  project?: { id?: string; name?: string };
  nextAction?: string;
  /** can_i_deploy / production_history: the authoritative verdict's scan. */
  verdictScanId?: string | null;
  currentVerdictScanId?: string | null;
  deploymentRecommendation?: "SHIP_IT" | "DO_NOT_DEPLOY" | "MORE_ANALYSIS_REQUIRED";
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
  projectId: string,
  /** Scan of the authoritative verdict; alerts for any other decision are historical. */
  currentScanId: string | null = null
): Promise<McpAlertSurface> {
  const rows = await getOpenAlertsForProject(admin, projectId, 5);
  const openAlerts = sortAlertsByPriority(
    rows
      .map(mapAlertRow)
      .map((a) => ({ ...a, priority: severityProfile(a.severity).priority }))
      .map((a) => ({ ...a, historical: isHistoricalAlert(a, currentScanId) }))
  );
  // Only alerts that describe the CURRENT decision may drive guidance. A
  // superseded deploy alert stays visible (marked historical) but is never
  // the primary alert, the worry signal, or the founder guidance.
  const current = openAlerts.filter((a) => !a.historical);
  const primary = current.find((a) => a.severity === "critical") ?? current[0] ?? null;

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

  const surface = await loadMcpAlertSurface(
    admin,
    projectId,
    result.verdictScanId ?? result.currentVerdictScanId ?? null
  );

  if (toolName === "can_i_deploy") {
    let summary = result.summary ?? "";
    if (surface.primaryAlert && (surface.primaryAlert.severity === "critical" || surface.primaryAlert.severity === "high")) {
      const unread = surface.openAlerts.some((a) => !a.readAt);
      if (unread) {
        summary = `${alertOpeningBlock(surface.primaryAlert)}\n\n${summary}`;
      }
    } else if (
      !surface.shouldWorry &&
      summary.length > 0 &&
      result.deploymentRecommendation === "SHIP_IT"
    ) {
      // "Nothing urgent" is only a truthful lead when the canonical decision
      // is a clean ship; it must never precede "I can't answer responsibly yet".
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
