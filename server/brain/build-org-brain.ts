import { verdictAffirmsDeploy } from "@/brain/production-verdict/deployment-posture";
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BRAIN_VERSION,
  type OrgBrainSnapshot,
  type ProjectBrainSummary,
  type ReadinessDimensionKey,
  type ReadinessDimensions,
} from "@/brain";
import { buildProductionRoadmap } from "@/brain/production-experience/roadmap";
import { getLatestVerdictsByOrganization } from "@/server/production-verdict/service";
import { productionReadyFromVerdict } from "./verdict-view-model";
import { mergeProjectActivity } from "./build-project-brain";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { applyLiveVerdictStates, loadLiveVerdictStates } from "./live-verdict-state";

const ORG_BRAIN_CACHE_TTL_MS = 20_000;

const DIMENSION_KEYS: ReadinessDimensionKey[] = [
  "security",
  "authentication",
  "databaseDesign",
  "bestPractices",
  "architecture",
  "performance",
  "deploymentReadiness",
];

function averageDimensions(
  dimensionSets: ReadinessDimensions[]
): ReadinessDimensions {
  const result = {} as ReadinessDimensions;
  for (const key of DIMENSION_KEYS) {
    const values = dimensionSets
      .map((set) => set[key])
      .filter((value): value is number => value !== null);
    result[key] =
      values.length > 0
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null;
  }
  return result;
}

export function summaryFromVerdict(
  project: { id: string; name: string; repository_health?: string | null },
  verdict: import("@/brain/production-verdict/schema").ProductionVerdictV1 | null
): ProjectBrainSummary {
  if (!verdict) {
    return {
      projectId: project.id,
      projectName: project.name,
      productionReady: null,
      scoreDelta: null,
      projectedScore: null,
      blockersCount: 0,
      healthStatus: project.repository_health ?? null,
      status: "insufficient_data",
      lastReviewedCommit: null,
      generatedAt: null,
      affirmsDeploy: false,
      verdictScanId: null,
      verdictState: "none",
    };
  }

  return {
    projectId: project.id,
    projectName: project.name,
    productionReady: verdict.score,
    scoreDelta: verdict.scoreDelta,
    projectedScore: verdict.projectedScore,
    blockersCount: verdict.blockersCount,
    healthStatus: project.repository_health ?? null,
    status: verdict.status,
    lastReviewedCommit: verdict.commitSha,
    generatedAt: verdict.generatedAt,
    affirmsDeploy: verdictAffirmsDeploy(verdict),
    verdictScanId: verdict.scanId,
    verdictState: "current",
  };
}

export async function buildOrgBrain(
  supabase: SupabaseClient,
  organizationId: string
): Promise<OrgBrainSnapshot> {
  const [{ data: projects }, verdictsByProject] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, repository_health")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false }),
    getLatestVerdictsByOrganization(supabase, organizationId),
  ]);

  const summaries: ProjectBrainSummary[] = [];
  const dimensionSets: ReadinessDimensions[] = [];
  let totalEstimatedMinutes = 0;

  for (const project of projects ?? []) {
    const verdict = verdictsByProject.get(project.id) ?? null;
    const summary = summaryFromVerdict(project, verdict);
    summaries.push(summary);

    if (verdict && verdict.score !== null) {
      dimensionSets.push(productionReadyFromVerdict(verdict).dimensions);
      totalEstimatedMinutes += verdict.estimatedFixMinutes;
    }
  }

  const scored = summaries.filter((item) => item.productionReady !== null);
  const averageProductionReady =
    scored.length > 0
      ? Math.round(
          scored.reduce((sum, item) => sum + (item.productionReady ?? 0), 0) / scored.length
        )
      : null;

  const { data: orgPriorities } = await supabase
    .from("ai_priorities")
    .select("rank, title, description, estimated_minutes")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(5);

  const recentActivity = await mergeProjectActivity(supabase, organizationId, undefined, 15);

  const todayPriorities = (orgPriorities ?? []).map((item, index) => ({
    rank: item.rank ?? index + 1,
    title: item.title,
    description: item.description,
    estimatedMinutes: item.estimated_minutes ?? undefined,
    source: "ai" as const,
  }));

  const productionRoadmap = buildProductionRoadmap({
    currentScore: averageProductionReady,
    priorities: todayPriorities,
  });

  return {
    organizationId,
    averageProductionReady,
    averageDimensions: averageDimensions(dimensionSets),
    totalBlockers: summaries.reduce((sum, item) => sum + item.blockersCount, 0),
    totalEstimatedMinutes,
    productionRoadmap,
    projects: summaries,
    todayPriorities,
    recentActivity,
    snapshotAt: new Date().toISOString(),
    brainVersion: BRAIN_VERSION,
  };
}

export async function getCachedOrgBrain(
  supabase: SupabaseClient,
  organizationId: string
): Promise<OrgBrainSnapshot> {
  const admin = createAdminClient();

  const { data: cached } = await admin
    .from("org_brain_cache")
    .select("payload, expires_at")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (cached && new Date(cached.expires_at as string).getTime() > Date.now()) {
    return withLiveVerdictState(supabase, organizationId, cached.payload as OrgBrainSnapshot);
  }

  const snapshot = await buildOrgBrain(supabase, organizationId);

  await admin.from("org_brain_cache").upsert(
    {
      organization_id: organizationId,
      payload: snapshot,
      expires_at: new Date(Date.now() + ORG_BRAIN_CACHE_TTL_MS).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" }
  );

  // The cache stores the pure snapshot; the live state is applied on every read (never cached).
  return withLiveVerdictState(supabase, organizationId, snapshot);
}

/**
 * The 20 s snapshot cache must not decide whether a verdict is the CURRENT decision: a scan that starts or finishes
 * after the snapshot was taken changes that immediately. Applied on every read, cache hit or not.
 */
async function withLiveVerdictState(
  supabase: SupabaseClient,
  organizationId: string,
  snapshot: OrgBrainSnapshot
): Promise<OrgBrainSnapshot> {
  const states = await loadLiveVerdictStates(supabase, organizationId, snapshot.projects);
  return { ...snapshot, projects: applyLiveVerdictStates(snapshot.projects, states) };
}
