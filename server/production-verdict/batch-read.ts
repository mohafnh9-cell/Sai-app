import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeParseProductionVerdict } from "@/brain/production-verdict/schema";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

export async function getCurrentProductionVerdictsForProjects(
  admin: SupabaseClient,
  projectIds: string[]
): Promise<Map<string, ProductionVerdictV1>> {
  const result = new Map<string, ProductionVerdictV1>();
  if (projectIds.length === 0) {
    return result;
  }

  const { data: states } = await admin
    .from("repository_scan_state")
    .select("repository_id, current_verdict_id")
    .in("repository_id", projectIds);

  const verdictIds = [
    ...new Set(
      (states ?? [])
        .map((row) => row.current_verdict_id as string | null)
        .filter((value): value is string => Boolean(value))
    ),
  ];

  if (verdictIds.length > 0) {
    const { data: rows } = await admin
      .from("production_verdicts")
      .select("id, project_id, verdict")
      .in("id", verdictIds);

    for (const row of rows ?? []) {
      const parsed = safeParseProductionVerdict(row.verdict);
      if (parsed) {
        result.set(row.project_id as string, parsed);
      }
    }
  }

  const missingProjectIds = projectIds.filter((projectId) => !result.has(projectId));
  if (missingProjectIds.length > 0) {
    const { data: rows } = await admin
      .from("production_verdicts")
      .select("project_id, verdict, generated_at")
      .in("project_id", missingProjectIds)
      .order("generated_at", { ascending: false });

    for (const row of rows ?? []) {
      const projectId = row.project_id as string;
      if (result.has(projectId)) continue;
      const parsed = safeParseProductionVerdict(row.verdict);
      if (parsed) {
        result.set(projectId, parsed);
      }
    }
  }

  return result;
}

export async function getProductionVerdictScanIds(
  admin: SupabaseClient,
  scanIds: string[]
): Promise<Set<string>> {
  if (scanIds.length === 0) {
    return new Set();
  }

  const { data } = await admin
    .from("production_verdicts")
    .select("scan_id")
    .in("scan_id", scanIds);

  return new Set(
    (data ?? [])
      .map((row) => row.scan_id as string | null)
      .filter((scanId): scanId is string => Boolean(scanId))
  );
}
