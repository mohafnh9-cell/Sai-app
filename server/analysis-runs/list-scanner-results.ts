import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Scanner Results: technical execution history, not security interpretation.
 * Reuses the `scans` table directly -- it already carries the canonical
 * per-severity counts (critical/high/medium/low_count), scan_type, timing,
 * and error fields, so this needs no new table and no scan_findings query.
 */
export type ScannerResultListItem = {
  scanId: string;
  projectId: string;
  projectName: string;
  status: string;
  scanType: string | null;
  /** How the source code was ingested -- "github" or "upload" (Phase 10). */
  source: string;
  branch: string | null;
  commitSha: string | null;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  filesAnalyzed: number | null;
  findingsCount: number | null;
  criticalCount: number | null;
  highCount: number | null;
  mediumCount: number | null;
  errorMessage: string | null;
  hasVerdict: boolean;
};

/**
 * "Duration" here means the user's real wait -- started_at to completed_at
 * wall-clock time (repo fetch + rule engine + persistence + verdict).
 * metrics.durationMs is the rule-engine's own internal sub-timing (see Phase
 * 8's perf audit) and is intentionally NOT used here: showing it as "the"
 * scan duration would understate what the user actually waited for.
 */
function scanDurationMs(row: {
  metrics: unknown;
  started_at: string | null;
  completed_at: string | null;
}): number | null {
  if (row.started_at && row.completed_at) {
    const delta = new Date(row.completed_at).getTime() - new Date(row.started_at).getTime();
    if (delta >= 0) return delta;
  }
  const metricsDuration = (row.metrics as { durationMs?: number } | null)?.durationMs;
  return typeof metricsDuration === "number" && metricsDuration >= 0 ? metricsDuration : null;
}

export async function listScannerResultsForOrganization(
  admin: SupabaseClient,
  input: { organizationId: string; limit?: number }
): Promise<ScannerResultListItem[]> {
  const limit = input.limit ?? 50;

  const { data: scans, error } = await admin
    .from("scans")
    .select(
      "id, project_id, status, scan_type, source, branch, commit_sha, created_at, completed_at, started_at, files_analyzed, findings_count, critical_count, high_count, medium_count, error_message, metrics"
    )
    .eq("organization_id", input.organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list scanner results: ${error.message}`);
  }
  if (!scans || scans.length === 0) return [];

  const projectIds = [...new Set(scans.map((row) => row.project_id as string))];
  const scanIds = scans.map((row) => row.id as string);

  const [{ data: projects }, { data: verdicts }] = await Promise.all([
    admin.from("projects").select("id, name").in("id", projectIds),
    admin.from("production_verdicts").select("scan_id").in("scan_id", scanIds),
  ]);

  const projectNameById = new Map(
    (projects ?? []).map((row) => [row.id as string, row.name as string])
  );
  const scanIdsWithVerdict = new Set((verdicts ?? []).map((row) => row.scan_id as string));

  return scans.map((row) => ({
    scanId: row.id as string,
    projectId: row.project_id as string,
    projectName: projectNameById.get(row.project_id as string) ?? row.project_id as string,
    status: String(row.status ?? "unknown"),
    scanType: (row.scan_type as string | null) ?? null,
    source: String(row.source ?? "github"),
    branch: (row.branch as string | null) ?? null,
    commitSha: (row.commit_sha as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at as string).toISOString() : null,
    durationMs: scanDurationMs({
      metrics: row.metrics,
      started_at: row.started_at as string | null,
      completed_at: row.completed_at as string | null,
    }),
    filesAnalyzed: (row.files_analyzed as number | null) ?? null,
    findingsCount: (row.findings_count as number | null) ?? null,
    criticalCount: (row.critical_count as number | null) ?? null,
    highCount: (row.high_count as number | null) ?? null,
    mediumCount: (row.medium_count as number | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    hasVerdict: scanIdsWithVerdict.has(row.id as string),
  }));
}

export async function getScannerResultDetail(
  admin: SupabaseClient,
  input: { organizationId: string; scanId: string }
): Promise<
  | (ScannerResultListItem & {
      executionTrace: Array<{ stage: string; at: string }>;
    })
  | null
> {
  const { data: scan, error } = await admin
    .from("scans")
    .select(
      "id, project_id, organization_id, status, scan_type, source, branch, commit_sha, created_at, completed_at, started_at, files_analyzed, findings_count, critical_count, high_count, medium_count, error_message, metrics"
    )
    .eq("id", input.scanId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (error || !scan) return null;

  const [{ data: project }, { data: verdict }, { data: scanJob }] = await Promise.all([
    admin.from("projects").select("id, name").eq("id", scan.project_id).maybeSingle(),
    admin
      .from("production_verdicts")
      .select("scan_id")
      .eq("scan_id", scan.id)
      .maybeSingle(),
    admin
      .from("scan_jobs")
      .select("metadata")
      .eq("scan_id", scan.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const trace =
    (scanJob?.metadata as { executionTrace?: { stages?: Array<{ stage: string; at: string }> } } | null)
      ?.executionTrace?.stages ?? [];

  return {
    scanId: scan.id as string,
    projectId: scan.project_id as string,
    projectName: (project?.name as string | undefined) ?? (scan.project_id as string),
    status: String(scan.status ?? "unknown"),
    scanType: (scan.scan_type as string | null) ?? null,
    source: String(scan.source ?? "github"),
    branch: (scan.branch as string | null) ?? null,
    commitSha: (scan.commit_sha as string | null) ?? null,
    createdAt: new Date(scan.created_at as string).toISOString(),
    completedAt: scan.completed_at ? new Date(scan.completed_at as string).toISOString() : null,
    durationMs: scanDurationMs({
      metrics: scan.metrics,
      started_at: scan.started_at as string | null,
      completed_at: scan.completed_at as string | null,
    }),
    filesAnalyzed: (scan.files_analyzed as number | null) ?? null,
    findingsCount: (scan.findings_count as number | null) ?? null,
    criticalCount: (scan.critical_count as number | null) ?? null,
    highCount: (scan.high_count as number | null) ?? null,
    mediumCount: (scan.medium_count as number | null) ?? null,
    errorMessage: (scan.error_message as string | null) ?? null,
    hasVerdict: Boolean(verdict),
    executionTrace: trace,
  };
}
