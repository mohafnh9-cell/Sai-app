import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { newerScanAwaitingVerdict } from "@/server/production-verdict/pending-verdict";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { deployAnswerFromVerdictEvidence } from "@/server/production-memory/types";
import { protectionDecisionFor, type ProtectionDecision } from "@/brain/production-verdict/protection-decision";
import { safeFixOffer, type SafeFixOffer } from "@/brain/production-verdict/safe-fix-eligibility";
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
  /** The canonical-verdict projection the panel renders. The panel never decides safety itself. */
  decision: ProtectionDecision;
  /** Present only when a real, current, supported finding exists. */
  safeFix: SafeFixOffer | null;
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
  /** Derived from the canonical decision policy (used by the alert engine); not a status-machine input. */
  deployAnswer: "go" | "no_go" | "not_yet" | null;
  /** A default-branch review is running (repository_scan_state.active_scan_id). */
  reviewInProgress: boolean;
  /** repository_scan_state.last_scan_id: the scan the current verdict must belong to. */
  currentScanId: string | null;
  defaultBranch: string | null;
  decision: ProtectionDecision;
};

export async function loadProtectionContext(
  admin: SupabaseClient,
  projectId: string
): Promise<ProtectionContext | null> {
  const { data: project } = await admin
    .from("projects")
    .select("id, organization_id, github_repo, github_repository_id, github_default_branch")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return null;

  const organizationId = project.organization_id as string;

  const [cpRow, syncRow, profileRow, verdict, snapshots, scanState, reviewState] = await Promise.all([
    admin.from("project_continuous_protection").select("*").eq("project_id", projectId).maybeSingle(),
    admin.from("repository_sync_status").select("connection_status, commit_sha").eq("project_id", projectId).maybeSingle(),
    admin.from("project_memory_profile").select("first_protected_at").eq("project_id", projectId).maybeSingle(),
    getCurrentProductionVerdict(admin, organizationId, projectId),
    admin
      .from("protection_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .order("snapshot_date", { ascending: false })
      .limit(8),
    admin
      .from("repository_scan_state")
      .select("active_scan_id, last_scan_id")
      .eq("repository_id", projectId)
      .maybeSingle(),
    // The same review-state read Mission Control uses (scan_jobs-based), so both surfaces agree on
    // "a review is running". Read-only: stale-review recovery stays with Mission Control.
    getProductionReviewState(admin, { organizationId, projectId, recoverStale: false }),
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

  // A newer scan that already completed but has not written its verdict yet is still "a review in
  // progress": `verdict` is then the previous scan's, which must not be shown as the current posture.
  const reviewInProgress =
    reviewState.hasActiveReview ||
    Boolean(scanState.data?.active_scan_id) ||
    (verdict ? await newerScanAwaitingVerdict(admin, projectId, verdict.scanId) : false);
  const decision = protectionDecisionFor({ verdict, reviewInProgress });
  const openCritical = verdict?.criticalBlockersCount ?? 0;
  const openHigh = verdict?.highBlockersCount ?? 0;
  const worries = verdict?.topPriorities?.slice(0, 3).map((p) => p.title) ?? [];

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
    deployAnswer: verdict ? deployAnswerFromVerdictEvidence(verdict) : null,
    reviewInProgress,
    currentScanId: (scanState.data?.last_scan_id as string | null | undefined) ?? null,
    defaultBranch: (project.github_default_branch as string | null | undefined) ?? null,
    decision,
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
    decision: ctx.decision,
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

  const hasVerdict = ctx.decision.state === "verdict" && ctx.verdict != null;

  // The recommendation is the canonical verdict's own (policy-guarded) recommended
  // action -- never a status-keyed static string. Without a verdict there is none.
  const recommendation = hasVerdict ? ctx.verdict!.recommendedAction : "";

  // "Apply Safe Fix" only for a real, current, supported finding.
  let safeFix: SafeFixOffer | null = null;
  const topFindingIds = hasVerdict ? ctx.verdict!.topPriorities?.[0]?.findingIds ?? [] : [];
  if (hasVerdict && topFindingIds.length > 0) {
    const { data: findingRows } = await admin
      .from("scan_findings")
      .select("id, project_id, scan_id, status, recommendation")
      .eq("scan_id", ctx.verdict!.scanId)
      .in("id", topFindingIds.slice(0, 50));
    safeFix = safeFixOffer({
      projectId,
      currentScanId: ctx.currentScanId,
      defaultBranch: ctx.defaultBranch,
      verdict: ctx.verdict,
      findings: (findingRows ?? []) as Array<{
        id: string;
        project_id: string;
        scan_id: string;
        status: string | null;
        recommendation: string | null;
      }>,
    });
  }

  return {
    projectId,
    status,
    decision: ctx.decision,
    safeFix,
    statusHeadline: statusHeadline(status),
    // Scores and concerns are verdict-derived: shown only when a completed current verdict exists.
    productionConfidence: hasVerdict ? ctx.productionConfidence : null,
    securityConfidence: hasVerdict ? ctx.securityConfidence : null,
    healthScore: health.healthScore,
    healthLabel: health.healthLabel,
    protectionHealth: health.protectionHealth,
    productionHealth: health.productionHealth,
    securityHealth: health.securityHealth,
    worriesTop3: hasVerdict ? ctx.worries : [],
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
    decision: ctx.decision,
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
