import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanFinding } from "@/features/security-scanner/components/types";
import type { AnalysisRunId } from "./types";

export async function loadAnalysisRunFindingsForFixPrompt(
  client: SupabaseClient,
  runId: AnalysisRunId
): Promise<ScanFinding[]> {
  const { data, error } = await client
    .from("scan_findings")
    .select(
      "id, title, description, severity, recommendation, category, file_path, start_line, rule_id, confidence, fingerprint"
    )
    .eq("scan_id", runId);

  if (error) {
    console.warn({
      component: "analysis-run-findings",
      event: "load_failed",
      runId,
      error: error.message,
    });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? undefined,
    severity: row.severity as string,
    category: row.category as string,
    recommendation: (row.recommendation as string | null) ?? undefined,
    file_path: row.file_path as string,
    start_line: (row.start_line as number | null) ?? undefined,
    rule_id: row.rule_id as string,
    confidence: row.confidence as string,
    fingerprint: row.fingerprint as string,
  }));
}
