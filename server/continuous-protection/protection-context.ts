import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { deployAnswerFromVerdictStatus } from "@/server/production-memory/types";
import {
  computeHealthBundle,
  confidenceTrendNarrative,
  type ConfidenceTrendPoint,
} from "./health-models";
import { evaluateProtectionStatus, isCheckStale } from "./status-machine";
import {
  labelFromStorage,
  statusHeadline,
  storageFromLabel,
  type ProtectionStatusLabel,
  type ProtectionStatusStorage,
} from "./types";

export type ProtectionCenterModel = {
  projectId: string;
  status: ProtectionStatusLabel;
  statusHeadline: string;
  productionConfidence: number | null;
  securityConfidence: number | null;
  healthScore: number | null;
  healthLabel: string | null;
  protectionHealth: string | null;
  productionHealth: string | null;
  securityHealth: string | null;
  worriesTop3: string[];
  recommendation: string;
  lastCheckedAt: string | null;
  continuousProtectionEnabled: boolean;
  continuousProtectionPaused: boolean;
  confidenceTrend30d: ConfidenceTrendPoint[];
  weeklySummaryPreview: {
    weekStart: string;
    narrative: string;
    checksCompleted: number;
    productionDelta: number | null;
    securityDelta: number | null;
    trendNarrative: string;
  } | null;
};

export type ProtectionContext = {
  organizationId: string;
  projectId: string;
  cpEnabled: boolean;
  cpPaused: boolean;
  githubConnected: boolean;
  hasSuccessfulReview: boolean;
  lastCheckAt: string | null;
  consecutiveDailyFailures: number;
  verdict: ProductionVerdictV1 | null;
  latestSnapshotStatus: ProtectionStatusStorage | null;
  productionConfidence: number | null;
  securityConfidence: number | null;
  productionDelta7d: number | null;
  securityDelta7d: number | null;
  worries: string[];
  openCritical: number;
  openHigh: number;
  deployAnswer: "go" | "no_go" | "not_yet" | null;
};

export async function loadProtectionContext(
  admin: SupabaseClient,
  projectId: string
): Promise<ProtectionContext | null> {
  const { data: project } = await admin
    .from("projects")
    .select("id, organization_id, github_repo, github_repository_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return null;

  const organizationId = project.organization_id as string;

  const [cpRow, syncRow, profileRow, verdict, snapshots] = await Promise.all([
    admin.from("project_continuous_protection").select("*").eq("project_id", projectId).maybeSingle(),
    admin.from("repository_sync_status").select("connection_status, commit_sha").eq("project_id", projectId).maybeSingle(),
    admin.from("project_memory_profile").select("first_protected_at").eq("project_id", projectId).maybeSingle(),
    getCurrentProductionVerdict(admin, projectId),
    admin
      .from("protection_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .order("snapshot_date", { ascending: false })
      .limit(8),
  ]);

  const githubConnected =
    syncRow.data?.connection_status === "connected" &&
    Boolean(project.github_repo || project.github_repository_id);

  const hasSuccessfulReview = Boolean(profileRow.data?.first_protected_at);
  const latest = snapshots.data?.[0];
  const weekAgo = snapshots.data?.find((s, i) => i >= Math.min(6, (snapshots.data?.length ?? 1) - 1));

  const productionConfidence = latest?.production_confidence ?? verdict?.score ?? null;
  const securityConfidence = latest?.security_confidence ?? verdict?.score ?? null;

  const productionDelta7d =
    weekAgo?.production_confidence != null && latest?.production_confidence != null
      ? latest.production_confidence - weekAgo.production_confidence
      : null;
  const securityDelta7d =
    weekAgo?.security_confidence != null && latest?.security_confidence != null
      ? latest.security_confidence - weekAgo.security_confidence
      : null;

  const openCritical = verdict?.criticalBlockersCount ?? 0;
  const openHigh = verdict?.highBlockersCount ?? 0;
  const worries = verdict?.topPriorities.slice(0, 3).map((p) => p.title) ?? [];

  return {
    organizationId,
    projectId,
    cpEnabled: cpRow.data?.enabled ?? true,
    cpPaused: Boolean(cpRow.data?.paused_at),
    githubConnected,
    hasSuccessfulReview,
    lastCheckAt: cpRow.data?.last_daily_completed_at ?? latest?.updated_at ?? null,
    consecutiveDailyFailures: cpRow.data?.consecutive_daily_failures ?? 0,
    verdict,
    latestSnapshotStatus: (latest?.protection_status as ProtectionStatusStorage) ?? null,
    productionConfidence,
    securityConfidence,
    productionDelta7d,
    securityDelta7d,
    worries,
    openCritical,
    openHigh,
    deployAnswer: verdict ? deployAnswerFromVerdictStatus(verdict.status) : null,
  };
}

export async function getProtectionCenterModel(
  admin: SupabaseClient,
  projectId: string
): Promise<ProtectionCenterModel | null> {
  const ctx = await loadProtectionContext(admin, projectId);
  if (!ctx) return null;

  const cpActive = ctx.cpEnabled && !ctx.cpPaused;
  const status = evaluateProtectionStatus({
    continuousProtectionEnabled: ctx.cpEnabled,
    continuousProtectionPaused: ctx.cpPaused,
    githubConnected: ctx.githubConnected,
    hasSuccessfulReview: ctx.hasSuccessfulReview,
    lastCheckAt: ctx.lastCheckAt,
    consecutiveDailyFailures: ctx.consecutiveDailyFailures,
    deployAnswer: ctx.deployAnswer,
    openCriticalCount: ctx.openCritical,
    openHighCount: ctx.openHigh,
    productionConfidence: ctx.productionConfidence,
    securityConfidence: ctx.securityConfidence,
    productionConfidenceDelta7d: ctx.productionDelta7d,
    securityConfidenceDelta7d: ctx.securityDelta7d,
    materialChangeIn7d: false,
    attackSurfaceIncreased: false,
    newCriticalDependencyAdvisory: false,
    staleCheckWhileCpOn: isCheckStale(ctx.lastCheckAt, cpActive),
  });

  const health = computeHealthBundle({
    productionConfidence: ctx.productionConfidence,
    securityConfidence: ctx.securityConfidence,
    lastCheckAt: ctx.lastCheckAt,
    openCriticalHighCount: ctx.openCritical + ctx.openHigh,
    protectionStatus: status,
  });

  const { data: trendRows } = await admin
    .from("protection_snapshots")
    .select("snapshot_date, production_confidence, security_confidence, health_score")
    .eq("project_id", projectId)
    .order("snapshot_date", { ascending: false })
    .limit(30);

  const confidenceTrend30d: ConfidenceTrendPoint[] = (trendRows ?? [])
    .reverse()
    .map((row) => ({
      date: row.snapshot_date as string,
      productionConfidence: row.production_confidence as number | null,
      securityConfidence: row.security_confidence as number | null,
      healthScore: row.health_score as number | null,
    }));

  const { data: weekly } = await admin
    .from("protection_weekly_summaries")
    .select("*")
    .eq("project_id", projectId)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  const recommendation =
    status === "NOT_PROTECTED"
      ? ctx.githubConnected
        ? "Run a protection review to start continuous protection."
        : "Connect GitHub to start protecting this application."
      : status === "REQUIRES_ATTENTION"
        ? "Review again after you apply Safe Fix."
        : status === "SAFE_WITH_CAUTION"
          ? "Apply Safe Fix."
          : "Keep building — ask SequrAI before your next deploy.";

  return {
    projectId,
    status,
    statusHeadline: statusHeadline(status),
    productionConfidence: ctx.productionConfidence,
    securityConfidence: ctx.securityConfidence,
    healthScore: health.healthScore,
    healthLabel: health.healthLabel,
    protectionHealth: health.protectionHealth,
    productionHealth: health.productionHealth,
    securityHealth: health.securityHealth,
    worriesTop3: ctx.worries,
    recommendation,
    lastCheckedAt: ctx.lastCheckAt,
    continuousProtectionEnabled: ctx.cpEnabled,
    continuousProtectionPaused: ctx.cpPaused,
    confidenceTrend30d,
    weeklySummaryPreview: weekly
      ? {
          weekStart: weekly.week_start as string,
          narrative: weekly.narrative as string,
          checksCompleted: weekly.checks_completed as number,
          productionDelta:
            weekly.production_confidence_end != null && weekly.production_confidence_start != null
              ? (weekly.production_confidence_end as number) -
                (weekly.production_confidence_start as number)
              : null,
          securityDelta:
            weekly.security_confidence_end != null && weekly.security_confidence_start != null
              ? (weekly.security_confidence_end as number) -
                (weekly.security_confidence_start as number)
              : null,
          trendNarrative: confidenceTrendNarrative(
            weekly.production_confidence_end != null && weekly.production_confidence_start != null
              ? (weekly.production_confidence_end as number) -
                  (weekly.production_confidence_start as number)
              : null,
            weekly.security_confidence_end != null && weekly.security_confidence_start != null
              ? (weekly.security_confidence_end as number) -
                  (weekly.security_confidence_start as number)
              : null
          ),
        }
      : null,
  };
}

export async function recomputeAndPersistProtectionState(
  admin: SupabaseClient,
  ctx: ProtectionContext,
  options?: { materialChange?: boolean; dependencyAdvisory?: boolean }
): Promise<ProtectionStatusLabel> {
  const cpActive = ctx.cpEnabled && !ctx.cpPaused;
  const status = evaluateProtectionStatus({
    continuousProtectionEnabled: ctx.cpEnabled,
    continuousProtectionPaused: ctx.cpPaused,
    githubConnected: ctx.githubConnected,
    hasSuccessfulReview: ctx.hasSuccessfulReview,
    lastCheckAt: ctx.lastCheckAt,
    consecutiveDailyFailures: ctx.consecutiveDailyFailures,
    deployAnswer: ctx.deployAnswer,
    openCriticalCount: ctx.openCritical,
    openHighCount: ctx.openHigh,
    productionConfidence: ctx.productionConfidence,
    securityConfidence: ctx.securityConfidence,
    productionConfidenceDelta7d: ctx.productionDelta7d,
    securityConfidenceDelta7d: ctx.securityDelta7d,
    materialChangeIn7d: options?.materialChange ?? false,
    attackSurfaceIncreased: false,
    newCriticalDependencyAdvisory: options?.dependencyAdvisory ?? false,
    staleCheckWhileCpOn: isCheckStale(ctx.lastCheckAt, cpActive),
  });

  const health = computeHealthBundle({
    productionConfidence: ctx.productionConfidence,
    securityConfidence: ctx.securityConfidence,
    lastCheckAt: ctx.lastCheckAt,
    openCriticalHighCount: ctx.openCritical + ctx.openHigh,
    protectionStatus: status,
  });

  const { upsertSnapshotStatus, recordProtectionStatusChange } = await import("./cp-memory-bridge");
  const nextStorage = await upsertSnapshotStatus(admin, {
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    status,
    productionConfidence: ctx.productionConfidence,
    securityConfidence: ctx.securityConfidence,
    healthScore: health.healthScore,
    healthLabel: health.healthLabel,
    worries: ctx.worries,
    openCriticalHighCount: ctx.openCritical + ctx.openHigh,
  });

  await recordProtectionStatusChange(admin, {
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    from: ctx.latestSnapshotStatus,
    to: nextStorage,
  });

  return status;
}
