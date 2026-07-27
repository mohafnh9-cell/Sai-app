import type { LlmMissionControlMetrics } from "@/server/ai-red-team/llm-team/integration/platform-payload";

export function parseLlmMetricsFromMetadata(
  meta: Record<string, unknown> | null | undefined
): LlmMissionControlMetrics | undefined {
  if (!meta) return undefined;
  const raw = meta.llmMetrics;
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as LlmMissionControlMetrics;
  if (typeof m.executionGraphNodes !== "number") return undefined;
  return m;
}

export function mergeLlmTeamExecutionFromMetadata(
  meta: Record<string, unknown> | null | undefined
): Partial<Record<"llm", "completed" | "skipped" | "failed">> | undefined {
  if (!meta) return undefined;
  const teamExec = meta.teamExecution;
  if (teamExec && typeof teamExec === "object") {
    const llm = (teamExec as Record<string, unknown>).llm;
    if (llm === "completed" || llm === "skipped" || llm === "failed") {
      return { llm };
    }
  }
  const llmResult = meta.llmTeamResult;
  if (llmResult && typeof llmResult === "object") {
    const status = (llmResult as Record<string, unknown>).status;
    if (status === "completed" || status === "skipped" || status === "failed") {
      return { llm: status };
    }
  }
  return undefined;
}
