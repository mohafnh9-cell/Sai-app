import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineExecutionStatus, EngineId } from "./types";

/**
 * Phase 35, section 26: MCP preparation only -- this is a read-only summary
 * shape for a future MCP surface to consume. The autonomous planner/one-
 * command orchestration itself is explicitly Phase 36+ and is NOT built
 * here; this function does not select or run engines, it only reports what
 * already ran for a given scan.
 */
export type EngineStatusSummary = Partial<Record<EngineId, EngineExecutionStatus>>;

export async function loadEngineStatusSummary(admin: SupabaseClient, scanId: string): Promise<EngineStatusSummary> {
  const { data, error } = await admin
    .from("engine_executions")
    .select("engine, status, created_at")
    .eq("scan_id", scanId)
    .order("created_at", { ascending: false });

  if (error || !data) return {};

  const summary: EngineStatusSummary = {};
  for (const row of data as Array<{ engine: EngineId; status: EngineExecutionStatus }>) {
    // First (most recent, due to the order above) row per engine wins.
    if (!(row.engine in summary)) summary[row.engine] = row.status;
  }
  return summary;
}
