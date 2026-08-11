import "server-only";

import { generateProductionVerdict } from "@/brain/production-verdict/engine";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { safeParseProductionVerdict } from "@/brain/production-verdict/schema";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LiveVerdictScanRow = {
  id: string;
  commit_sha?: string | null;
  branch?: string | null;
  status?: string | null;
  security_score?: number | null;
  files_analyzed?: number | null;
  files_discovered?: number | null;
  repository_id?: string | null;
};

/** Keep in sync with all live-verdict scan reads. */
export const LIVE_VERDICT_SCAN_SELECT =
  "id, commit_sha, branch, status, security_score, files_analyzed, files_discovered, repository_id";

export async function loadLiveVerdictScanRow(
  admin: SupabaseClient,
  scanId: string
): Promise<LiveVerdictScanRow | null> {
  const { data } = await admin
    .from("scans")
    .select(LIVE_VERDICT_SCAN_SELECT)
    .eq("id", scanId)
    .maybeSingle();

  return (data as LiveVerdictScanRow | null) ?? null;
}

async function resolveCanonicalLiveVerdictScan(
  admin: SupabaseClient,
  input: { projectId: string; persisted?: ProductionVerdictV1 | null }
): Promise<LiveVerdictScanRow | null> {
  const canonicalScanId = input.persisted?.scanId ?? null;
  if (canonicalScanId) {
    const canonical = await loadLiveVerdictScanRow(admin, canonicalScanId);
    if (canonical) {
      return canonical;
    }
  }

  const { data } = await admin
    .from("scans")
    .select(LIVE_VERDICT_SCAN_SELECT)
    .eq("project_id", input.projectId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as LiveVerdictScanRow | null) ?? null;
}

/**
 * Recompute the production verdict from persisted scan findings so classification
 * fixes apply even when the stored verdict row was generated before an engine update.
 */
export async function computeLiveProductionVerdict(
  admin: SupabaseClient,
  input: { projectId: string; scan?: LiveVerdictScanRow | null; persisted?: ProductionVerdictV1 | null }
): Promise<ProductionVerdictV1 | null> {
  const scan =
    input.scan ?? (await resolveCanonicalLiveVerdictScan(admin, { projectId: input.projectId, persisted: input.persisted }));

  if (!scan?.id) {
    return input.persisted ?? null;
  }

  const { data: findings } = await admin
    .from("scan_findings")
    .select(
      "id, title, severity, category, rule_id, file_path, start_line, recommendation, confidence, evidence, metadata"
    )
    .eq("scan_id", scan.id);

  const { verdict } = generateProductionVerdict({
    projectId: input.projectId,
    repositoryId: scan.repository_id ?? input.projectId,
    scanId: scan.id,
    commitSha: scan.commit_sha ?? null,
    branch: scan.branch ?? null,
    scanStatus: scan.status ?? "completed",
    securityScore: scan.security_score ?? input.persisted?.score ?? null,
    filesAnalyzed: scan.files_analyzed ?? 0,
    filesDiscovered: scan.files_discovered ?? 0,
    findings: findings ?? [],
    previousScore: input.persisted?.previousScore ?? null,
    previousBlockersCount: input.persisted?.blockersCount,
    partialScanFailure: scan.status !== "completed",
    aiExecutiveSummary: input.persisted?.executiveSummary ?? null,
  });

  return verdict;
}

export async function getLiveProductionVerdict(
  admin: SupabaseClient,
  projectId: string
): Promise<ProductionVerdictV1 | null> {
  const { data: state } = await admin
    .from("repository_scan_state")
    .select("current_verdict_id")
    .eq("repository_id", projectId)
    .maybeSingle();

  let persisted: ProductionVerdictV1 | null = null;
  if (state?.current_verdict_id) {
    const { data } = await admin
      .from("production_verdicts")
      .select("verdict, scan_id")
      .eq("id", state.current_verdict_id)
      .maybeSingle();
    persisted = data?.verdict ? safeParseProductionVerdict(data.verdict) : null;
  }

  if (!persisted) {
    const { data } = await admin
      .from("production_verdicts")
      .select("verdict, scan_id")
      .eq("project_id", projectId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    persisted = data?.verdict ? safeParseProductionVerdict(data.verdict) : null;
  }

  return computeLiveProductionVerdict(admin, { projectId, persisted });
}
