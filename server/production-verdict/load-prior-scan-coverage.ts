import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanCoverageSnapshot } from "@/brain/production-verdict/resolve-scan-coverage";

export async function loadPriorScanCoverage(
  admin: SupabaseClient,
  input: { projectId: string; excludeScanId: string }
): Promise<ScanCoverageSnapshot | null> {
  const { data: rows } = await admin
    .from("scans")
    .select("files_analyzed, files_discovered")
    .eq("project_id", input.projectId)
    .eq("status", "completed")
    .neq("id", input.excludeScanId)
    .order("completed_at", { ascending: false })
    .limit(8);

  const data = (rows ?? []).find((row) => ((row.files_analyzed as number | null) ?? 0) >= 3) ?? null;
  if (!data) return null;

  const filesAnalyzed = (data.files_analyzed as number | null) ?? 0;
  const filesDiscovered = (data.files_discovered as number | null) ?? 0;
  if (filesAnalyzed < 3) return null;

  return {
    filesAnalyzed,
    filesDiscovered: Math.max(filesDiscovered, filesAnalyzed),
  };
}
