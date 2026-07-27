import type { BusinessLogicMissionControlMetrics } from "@/server/ai-red-team/business-logic/integration/platform-payload";

export function parseBusinessLogicMetricsFromMetadata(
  meta: Record<string, unknown> | null | undefined
): BusinessLogicMissionControlMetrics | undefined {
  if (!meta) return undefined;
  const raw = meta.businessLogicMetrics;
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as BusinessLogicMissionControlMetrics;
  if (typeof m.workflowCount !== "number") return undefined;
  return m;
}

export function mergeTeamExecutionFromMetadata(
  meta: Record<string, unknown> | null | undefined
): Partial<Record<"business_logic", "completed" | "skipped" | "failed">> | undefined {
  if (!meta) return undefined;
  const teamExec = meta.teamExecution;
  if (teamExec && typeof teamExec === "object") {
    const bl = (teamExec as Record<string, unknown>).business_logic;
    if (bl === "completed" || bl === "skipped" || bl === "failed") {
      return { business_logic: bl };
    }
  }
  const blResult = meta.businessLogicTeamResult;
  if (blResult && typeof blResult === "object") {
    const status = (blResult as Record<string, unknown>).status;
    if (status === "completed" || status === "skipped" || status === "failed") {
      return { business_logic: status };
    }
  }
  return undefined;
}
