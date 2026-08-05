import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedTeamReport } from "@/server/ai-red-team/types";
import {
  buildDefaultSecurityTestOptions,
  buildSecurityTestOptionsFromHypotheses,
} from "./security-test-options";
import type { SecurityTestContext } from "@/features/security-testing/types";
import {
  buildProgressStepsForPhase,
  copyForPhase,
} from "@/features/security-testing/lib/product-copy";
import { deriveSecurityTestPhase } from "@/features/security-testing/lib/derive-phase";
import { getTranslator } from "@/lib/i18n/server";
import { extractAttackHypothesesFromRedTeamReport } from "./integration/extract-hypotheses-from-report";
import {
  getAttackCampaignByScanId,
  listAttackCampaignsForProject,
} from "./persistence/campaign-repository";
import { listAttackExecutionsForCampaign } from "./persistence/execution-repository";
import type { AttackHypothesis } from "./contracts/attack-hypothesis";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import type { AnalysisRunId } from "@/server/analysis-runs/types";

function parseRedTeamReportFromMetadata(metadata: unknown): RedTeamReport | null {
  if (!metadata || typeof metadata !== "object") return null;
  const root = metadata as Record<string, unknown>;
  const platform = (root.platform ?? root.platformConvergence) as Record<string, unknown> | undefined;
  if (!platform) return null;
  const report = platform.report;
  if (!report || typeof report !== "object") return null;
  return report as RedTeamReport;
}

function isTerminalReviewStatus(status: string): boolean {
  return status === "completed" || status === "cancelled" || status === "failed" || status === "stale";
}

export type SecurityTestContextPayload = SecurityTestContext & {
  hypotheses: AttackHypothesis[];
  analysisRunId?: AnalysisRunId | null;
};

export async function getSecurityTestContext(
  admin: SupabaseClient,
  input: {
    projectId: string;
    organizationId: string;
    analysisRunId?: AnalysisRunId | null;
    isolationEnabled?: boolean;
  }
): Promise<SecurityTestContextPayload> {
  const runQuery = input.analysisRunId ? `?run=${input.analysisRunId}` : "";
  const attackCenterHref = `/projects/${input.projectId}/attack-center${runQuery}`;
  const useProjectFallbacks = !input.isolationEnabled;

  const reviewState = await getProductionReviewState(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
  });

  const scopedRunId = input.analysisRunId ?? null;
  const reviewScopedToRun =
    scopedRunId != null && reviewState.scanId != null && reviewState.scanId === scopedRunId;

  const reviewInProgress = scopedRunId
    ? reviewScopedToRun &&
      reviewState.hasActiveReview &&
      !isTerminalReviewStatus(reviewState.status)
    : reviewState.hasActiveReview && !isTerminalReviewStatus(reviewState.status);

  const targetScanResult = scopedRunId
    ? await admin
        .from("scans")
        .select("id, commit_sha, status")
        .eq("id", scopedRunId)
        .eq("project_id", input.projectId)
        .eq("organization_id", input.organizationId)
        .maybeSingle()
    : useProjectFallbacks
      ? await admin
          .from("scans")
          .select("id, commit_sha, status")
          .eq("project_id", input.projectId)
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

  const targetScan = targetScanResult.data;
  const targetScanCompleted = targetScan?.status === "completed";

  const latestScanJobForScan = targetScan
    ? await admin
        .from("scan_jobs")
        .select("id, metadata, scan_id")
        .eq("project_id", input.projectId)
        .eq("scan_id", targetScan.id)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const latestScan =
    targetScan && targetScanCompleted
      ? {
          id: targetScan.id as string,
          scanJobId: (latestScanJobForScan.data?.id as string | null) ?? null,
          commitSha: (targetScan.commit_sha as string) ?? "unknown",
        }
      : null;

  const { t } = await getTranslator("securityTest");

  const report = parseRedTeamReportFromMetadata(latestScanJobForScan.data?.metadata);
  const hypotheses = extractAttackHypothesesFromRedTeamReport(report);
  const availableTests =
    hypotheses.length > 0
      ? buildSecurityTestOptionsFromHypotheses(hypotheses, t)
      : buildDefaultSecurityTestOptions(t);

  let campaignRow = null;
  let executions: Awaited<ReturnType<typeof listAttackExecutionsForCampaign>> = [];
  try {
    campaignRow = scopedRunId
      ? await getAttackCampaignByScanId(admin, scopedRunId, input.organizationId)
      : useProjectFallbacks
        ? (await listAttackCampaignsForProject(admin, {
            projectId: input.projectId,
            organizationId: input.organizationId,
            limit: 1,
          }))[0] ?? null
        : null;

    executions = campaignRow
      ? await listAttackExecutionsForCampaign(admin, campaignRow.id, input.organizationId)
      : [];
  } catch (error) {
    console.warn({
      component: "security-test-context",
      event: "campaign_load_failed",
      projectId: input.projectId,
      analysisRunId: scopedRunId,
      error: error instanceof Error ? error.message : String(error),
    });
    campaignRow = null;
    executions = [];
  }

  const latestCampaign = campaignRow
    ? {
        id: campaignRow.id,
        status: campaignRow.status,
        progressPercent: campaignRow.progressPercent,
        confirmedFindings: campaignRow.confirmedFindings,
        totalExecutions: campaignRow.totalExecutions,
        completedExecutions: campaignRow.completedExecutions,
        commitSha: campaignRow.commitSha,
      }
    : null;

  const phase = deriveSecurityTestPhase({
    reviewInProgress,
    hasLatestScan: Boolean(latestScan),
    campaignStatus: latestCampaign?.status ?? null,
    executionStatuses: executions.map((execution) => execution.status),
  });
  const copy = copyForPhase(phase, t);

  return {
    phase,
    headline: copy.headline,
    description: copy.description,
    primaryActionLabel: copy.primaryActionLabel,
    secondaryActionLabel: null,
    reviewInProgress,
    latestScan,
    campaign: latestCampaign,
    availableTests,
    progressSteps: buildProgressStepsForPhase(phase, t),
    attackCenterHref,
    hypotheses,
    analysisRunId: scopedRunId,
  };
}
