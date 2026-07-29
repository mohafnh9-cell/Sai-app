import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { toLegacyVerdict } from "@/brain/production-verdict/adapters/legacy";
import type { LegacyProductionVerdict } from "@/brain/production-verdict/adapters/legacy";
import { generateProductionVerdict } from "@/brain/production-verdict/engine";
import {
  generateAndPersistProductionVerdict,
  getProductionVerdictByScan,
  getCurrentProductionVerdict,
} from "@/server/production-verdict/service";

export type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
export {
  getProductionVerdictByScan,
  getCurrentProductionVerdict,
  compareProductionVerdicts,
} from "@/server/production-verdict/service";

export async function buildScanProductionVerdict(
  admin: SupabaseClient,
  input: {
    scanId: string;
    projectId: string;
    organizationId: string;
    securityScore?: number | null;
    severityCounts?: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      info: number;
    };
    categoryCounts?: Record<string, number>;
    findings?: Array<{ title: string; severity: string; recommendation?: string | null }>;
    persist?: boolean;
  }
): Promise<LegacyProductionVerdict> {
  const existing = await getProductionVerdictByScan(admin, input.scanId);
  if (existing) return toLegacyVerdict(existing);

  const persist = input.persist !== false;

  if (persist) {
    const verdict = await generateAndPersistProductionVerdict(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
    });
    if (verdict) return toLegacyVerdict(verdict);
  }

  const { data: scan } = await admin
    .from("scans")
    .select("*")
    .eq("id", input.scanId)
    .maybeSingle();

  const { data: findings } = await admin
    .from("scan_findings")
    .select("id, title, severity, category, rule_id, file_path, recommendation, evidence")
    .eq("scan_id", input.scanId);

  const { data: previousScan } = await admin
    .from("scans")
    .select("security_score, critical_count, high_count")
    .eq("project_id", input.projectId)
    .eq("status", "completed")
    .neq("id", input.scanId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { verdict } = generateProductionVerdict({
    projectId: input.projectId,
    repositoryId: scan?.repository_id ?? input.projectId,
    scanId: input.scanId,
    commitSha: scan?.commit_sha ?? scan?.commit,
    branch: scan?.branch,
    scanStatus: scan?.status ?? "completed",
    securityScore: scan?.security_score ?? input.securityScore ?? null,
    filesAnalyzed: scan?.files_analyzed ?? scan?.files_scanned ?? 0,
    findings: findings ?? input.findings ?? [],
    previousScore: previousScan?.security_score ?? null,
    previousBlockersCount:
      previousScan != null
        ? (previousScan.critical_count ?? 0) + (previousScan.high_count ?? 0)
        : undefined,
    partialScanFailure: scan?.status !== "completed",
  });

  return toLegacyVerdict(verdict);
}
