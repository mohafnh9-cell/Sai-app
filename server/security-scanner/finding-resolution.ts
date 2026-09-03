import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  diffScanFindingsByIdentity,
  type FindingResolutionDiff,
  type ScanFindingIdentitySnapshot,
} from "@/lib/correlation/scan-finding-resolution";

type FindingRow = {
  id: string;
  project_id: string;
  organization_id: string;
  rule_id: string;
  file_path: string;
  title: string;
  severity: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

function toSnapshot(row: FindingRow): ScanFindingIdentitySnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    ruleId: row.rule_id,
    filePath: row.file_path,
    title: row.title,
    severity: row.severity,
    status: row.status,
    metadata: row.metadata,
  };
}

const FINDING_COLUMNS = "id, project_id, organization_id, rule_id, file_path, title, severity, status, metadata";

/**
 * Returns the immediately-preceding completed scan for a project, excluding
 * `excludeScanId`. Mirrors the "previous scan" query already used by the
 * Production Verdict engine (server/production-verdict/core.ts) so both
 * systems agree on what "previous" means.
 */
async function loadPreviousScanId(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string; excludeScanId: string }
): Promise<string | null> {
  const { data, error } = await admin
    .from("scans")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("status", "completed")
    .neq("id", input.excludeScanId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { id: string }).id;
}

async function loadScanFindingSnapshots(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string; scanId: string }
): Promise<ScanFindingIdentitySnapshot[]> {
  const { data, error } = await admin
    .from("scan_findings")
    .select(FINDING_COLUMNS)
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("scan_id", input.scanId);

  if (error || !data) return [];
  return (data as FindingRow[]).map(toSnapshot);
}

export type ScanFindingResolutionResult = FindingResolutionDiff & {
  previousScanId: string | null;
  currentScanId: string;
};

/**
 * Computes NEW / RESOLVED / UNCHANGED finding identity for a project's
 * current scan against its immediately-preceding completed scan.
 *
 * Every query is scoped by both organization_id and project_id, so this
 * cannot compare or "resolve" findings across tenants or projects even if
 * called with a mismatched scanId. When there is no previous completed
 * scan (first scan for the project), every current finding is reported as
 * "new" and there is nothing to mark resolved.
 */
export async function getScanFindingResolution(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string; currentScanId: string }
): Promise<ScanFindingResolutionResult> {
  const previousScanId = await loadPreviousScanId(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    excludeScanId: input.currentScanId,
  });

  const current = await loadScanFindingSnapshots(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.currentScanId,
  });

  const previous = previousScanId
    ? await loadScanFindingSnapshots(admin, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        scanId: previousScanId,
      })
    : [];

  const diff = diffScanFindingsByIdentity({
    projectId: input.projectId,
    previous,
    current,
  });

  return { ...diff, previousScanId, currentScanId: input.currentScanId };
}
