import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentReport } from "./storage";

type McpEnrichable = {
  summary?: string;
  project?: { id?: string; name?: string };
  range?: string;
  /** can_i_deploy: the canonical, policy-gated recommendation for the current verdict. */
  deploymentRecommendation?: "SHIP_IT" | "DO_NOT_DEPLOY" | "MORE_ANALYSIS_REQUIRED";
};

/** Sprint 6 — report narrative on existing MCP tools (no new tools). */
export async function enrichMcpToolResultWithReports(
  admin: SupabaseClient,
  toolName: string,
  result: McpEnrichable
): Promise<McpEnrichable & { protectionReport?: { type: string; narrative: string; founderSummary?: unknown } }> {
  const projectId = result.project?.id;
  if (!projectId) return result;

  if (toolName === "production_history") {
    const range = result.range ?? "all";
    const reportType = range === "7d" ? "weekly" : "monthly";
    if (range === "all") {
      const monthly = await getCurrentReport(admin, projectId, "monthly");
      if (!monthly) return result;
      return attachReport(result, monthly, "monthly");
    }
    const report = await getCurrentReport(admin, projectId, reportType);
    if (!report) return result;
    return attachReport(result, report, reportType);
  }

  if (toolName === "can_i_deploy") {
    const monthly = await getCurrentReport(admin, projectId, "monthly");
    if (!monthly) return result;
    // The monthly report is a retrospective. Its "stronger posture" and
    // "I would deploy today" lines are first-person approvals that must never
    // be appended to a current decision the canonical policy does not
    // recommend deploying.
    const mayNarrateDeploy = result.deploymentRecommendation === "SHIP_IT";
    const worries = [
      "What worries me:",
      ...monthly.founderSummary.whatWorriesSequrAI.slice(0, 2).map((w) => `• ${w}`),
    ];
    const teaser = mayNarrateDeploy
      ? [
          monthly.founderSummary.moreProtectedNarrative,
          "",
          ...worries,
          "",
          monthly.founderSummary.wouldDeployToday,
        ].join("\n")
      : ["From the latest monthly protection report:", ...worries].join("\n");
    return {
      ...result,
      summary: `${result.summary ?? ""}\n\n${teaser}`.trim(),
      protectionReport: { type: "monthly", narrative: monthly.narrative, founderSummary: monthly.founderSummary },
    };
  }

  if (toolName === "what_changed") {
    const weekly = await getCurrentReport(admin, projectId, "weekly");
    if (!weekly) return result;
    const changes = weekly.reportData.whatBecameWorse.concat(weekly.reportData.whatImproved).slice(0, 4);
    if (!changes.length) return result;
    return {
      ...result,
      summary: `${result.summary ?? ""}\n\nFrom this week's protection report:\n${changes.map((c) => `• ${c}`).join("\n")}`.trim(),
      protectionReport: { type: "weekly", narrative: weekly.narrative, founderSummary: weekly.founderSummary },
    };
  }

  return result;
}

function attachReport(
  result: McpEnrichable,
  report: Awaited<ReturnType<typeof getCurrentReport>> & object,
  reportType: string
) {
  const block = (report as { narrative: string }).narrative.split("\n").slice(0, 28).join("\n");
  return {
    ...result,
    summary: `${result.summary ?? ""}\n\n${block}`.trim(),
    protectionReport: {
      type: reportType,
      narrative: (report as { narrative: string }).narrative,
      founderSummary: (report as { founderSummary: unknown }).founderSummary,
    },
  };
}
