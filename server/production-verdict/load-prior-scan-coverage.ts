import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { listPreviousCompletedScans } from "@/server/security-scanner/previous-scan";
import type { ScanCoverageSnapshot } from "@/brain/production-verdict/resolve-scan-coverage";

export async function loadPriorScanCoverage(
  admin: SupabaseClient,
  input: { projectId: string; excludeScanId: string; branch?: string | null }
): Promise<ScanCoverageSnapshot | null> {
  const rows = await listPreviousCompletedScans(
    admin,
    { projectId: input.projectId, branch: input.branch, excludeScanId: input.excludeScanId },
    "files_analyzed, files_discovered",
    8
  );

  const data = rows.find((row) => ((row.files_analyzed as number | null) ?? 0) >= 3) ?? null;
  if (!data) return null;

  const filesAnalyzed = (data.files_analyzed as number | null) ?? 0;
  const filesDiscovered = (data.files_discovered as number | null) ?? 0;
  if (filesAnalyzed < 3) return null;

  return {
    filesAnalyzed,
    filesDiscovered: Math.max(filesDiscovered, filesAnalyzed),
  };
}
