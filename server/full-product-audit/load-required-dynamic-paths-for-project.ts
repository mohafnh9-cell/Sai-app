import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslator } from "@/lib/i18n/server";
import { buildHypothesesFromStaticFindings } from "./build-hypotheses-from-findings";
import type { StaticFindingInput } from "./correlate-findings";
import { collectRequiredDynamicPaths } from "./required-dynamic-paths";
import { selectAttacksFromFindings } from "./select-attacks-from-findings";

export async function loadRequiredDynamicPathsForLatestScan(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string }
): Promise<string[]> {
  const { data: scan } = await admin
    .from("scans")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!scan?.id) return [];

  const { data: staticRows } = await admin
    .from("scan_findings")
    .select(
      "id, rule_id, title, description, severity, category, file_path, recommendation, confidence, evidence"
    )
    .eq("scan_id", scan.id);

  const staticFindings: StaticFindingInput[] = (staticRows ?? []).map((row) => ({
    id: row.id as string,
    ruleId: row.rule_id as string | null,
    title: row.title as string,
    description: row.description as string | null,
    severity: row.severity as string,
    category: row.category as string | null,
    filePath: row.file_path as string | null,
    recommendation: row.recommendation as string | null,
    confidence: row.confidence as string | null,
    evidence: row.evidence as string | null,
  }));

  if (staticFindings.length === 0) return [];

  const selectedAdapterIds = selectAttacksFromFindings({ staticFindings });
  const { t } = await getTranslator("securityTest");
  const built = buildHypothesesFromStaticFindings({
    staticFindings,
    selectedAdapterIds,
    requireMappedRoutes: true,
    t,
  });

  return collectRequiredDynamicPaths(built.hypotheses);
}
