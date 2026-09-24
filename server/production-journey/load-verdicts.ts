import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseProductionVerdict,
  type VerdictStatus,
} from "@/brain/production-verdict/schema";
import type { VerdictJourneyRecord } from "@/brain/production-journey/build";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "production-journey-loader", event, ...fields });
}

type VerdictRow = {
  id: string;
  scan_id: string;
  project_id: string;
  repository_id: string;
  status: string;
  score: number | null;
  previous_score: number | null;
  score_delta: number | null;
  blockers_count: number;
  introduced_blockers: number;
  resolved_blockers: number;
  verdict: unknown;
  generated_at: string;
};

function isMissingTableError(message: string): boolean {
  return message.includes("production_verdicts") && message.includes("does not exist");
}

export async function loadVerdictJourneyRecords(
  client: SupabaseClient,
  projectId: string,
  options?: { limit?: number }
): Promise<{ records: VerdictJourneyRecord[]; skippedInvalid: number }> {
  const limit = options?.limit ?? 200;

  // History/journey describe the default branch's evolution; a feature-branch
  // verdict must not be compared against (or shown as) the project's history.
  const { data: projectRow } = await client
    .from("projects")
    .select("github_default_branch")
    .eq("id", projectId)
    .maybeSingle();
  const defaultBranch =
    (projectRow as { github_default_branch?: string | null } | null)?.github_default_branch ?? null;

  const { data, error } = await client
    .from("production_verdicts")
    .select(
      `
      id,
      scan_id,
      project_id,
      repository_id,
      status,
      score,
      previous_score,
      score_delta,
      blockers_count,
      introduced_blockers,
      resolved_blockers,
      verdict,
      generated_at
    `
    )
    .eq("project_id", projectId)
    .order("generated_at", { ascending: true })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error.message)) {
      log("migration_missing", { projectId });
      return { records: [], skippedInvalid: 0 };
    }
    log("verdicts_load_failed", { projectId, error: error.message });
    throw new Error(error.message);
  }

  let skippedInvalid = 0;
  const records: VerdictJourneyRecord[] = [];

  for (const row of (data ?? []) as VerdictRow[]) {
    try {
      const verdict = parseProductionVerdict(row.verdict);
      if (defaultBranch && verdict.branch && verdict.branch !== defaultBranch) continue;
      records.push({
        id: row.id,
        scanId: row.scan_id,
        projectId: row.project_id,
        repositoryId: row.repository_id,
        // PostgREST returns timestamptz columns with a "+00:00" offset, not a
        // literal "Z". Normalize at this retrieval boundary so every
        // downstream consumer (ProductionJourneySchema's strict
        // z.string().datetime()) always sees a canonical ISO-8601 string.
        generatedAt: new Date(row.generated_at).toISOString(),
        commitSha: verdict.commitSha,
        branch: verdict.branch,
        status: row.status as VerdictStatus,
        score: row.score,
        previousScore: row.previous_score,
        scoreDelta: row.score_delta,
        blockersCount: row.blockers_count,
        introducedBlockers: row.introduced_blockers,
        resolvedBlockers: row.resolved_blockers,
        verdict,
      });
    } catch (cause) {
      skippedInvalid += 1;
      log("invalid_verdict_skipped", {
        projectId,
        verdictId: row.id,
        error: cause instanceof Error ? cause.message : "parse_failed",
      });
    }
  }

  log("verdicts_loaded", { projectId, count: records.length, skippedInvalid });
  return { records, skippedInvalid };
}
