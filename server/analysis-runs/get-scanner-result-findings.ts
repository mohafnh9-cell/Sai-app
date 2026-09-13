import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanFinding } from "@/features/security-scanner/components/types";

const COLUMNS =
  "id, title, description, severity, category, status, confidence, rule_id, file_path, start_line, recommendation, evidence, impact, metadata";

/**
 * Real findings for one specific scan, tenant-scoped -- the same
 * `scan_findings` table and column set the Production Verdict engine and
 * finding-resolution diff already read (server/production-verdict/core.ts,
 * server/security-scanner/finding-resolution.ts). Shaped as ScanFinding so
 * it's a drop-in for the existing SecurityFindingCard / TechnicalFindingsSection
 * components -- no new finding UI, no new backend logic.
 */
export async function getFindingsForScanResult(
  admin: SupabaseClient,
  organizationId: string,
  scanId: string
): Promise<ScanFinding[]> {
  const { data, error } = await admin
    .from("scan_findings")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .eq("scan_id", scanId);

  if (error || !data) {
    if (error) {
      console.warn({
        component: "scanner-result-findings",
        event: "load_failed",
        scanId,
        error: error.message,
      });
    }
    return [];
  }

  return data.map((row) => ({
    id: row.id as string,
    title: row.title as string | undefined,
    description: row.description as string | undefined,
    severity: row.severity as string | undefined,
    category: row.category as string | undefined,
    status: row.status as string | undefined,
    confidence: row.confidence as string | number | undefined,
    rule_id: row.rule_id as string | undefined,
    file_path: row.file_path as string | undefined,
    start_line: row.start_line as number | undefined,
    recommendation: row.recommendation as string | undefined,
    evidence: row.evidence as string | undefined,
    impact: row.impact as string | undefined,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  }));
}
