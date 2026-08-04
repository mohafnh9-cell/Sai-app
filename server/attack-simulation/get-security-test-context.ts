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
import { listAttackCampaignsForProject } from "./persistence/campaign-repository";
import { listAttackExecutionsForCampaign } from "./persistence/execution-repository";
import type { AttackHypothesis } from "./contracts/attack-hypothesis";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";

function parseRedTeamReportFromMetadata(metadata: unknown): RedTeamReport | null {
  if (!metadata || typeof metadata !== "object") return null;
  const root = metadata as Record<string, unknown>;
  const platform = (root.platform ?? root.platformConvergence) as Record<string, unknown> | undefined;
  if (!platform) return null;
  const report = platform.report;
  if (!report || typeof report !== "object") return null;
  return report as RedTeamReport;
}

export type SecurityTestContextPayload = SecurityTestContext & {
  hypotheses: AttackHypothesis[];
};

export async function getSecurityTestContext(
  admin: SupabaseClient,
  input: { projectId: string; organizationId: string }
): Promise<SecurityTestContextPayload> {
  const attackCenterHref = `/projects/${input.projectId}/attack-center`;

  const [reviewState, latestCompletedScan, campaigns] = await Promise.all([
    getProductionReviewState(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
    }),
    admin
      .from("scans")
      .select("id, commit_sha, status")
      .eq("project_id", input.projectId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    listAttackCampaignsForProject(admin, {
      projectId: input.projectId,
      organizationId: input.organizationId,
      limit: 1,
    }),
  ]);

  const latestScanJobForScan = latestCompletedScan.data
    ? await admin
        .from("scan_jobs")
        .select("id, metadata, scan_id")
        .eq("project_id", input.projectId)
        .eq("scan_id", latestCompletedScan.data.id)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const reviewInProgress = reviewState.hasActiveReview;
  const latestScan = latestCompletedScan.data
    ? {
        id: latestCompletedScan.data.id as string,
        scanJobId: (latestScanJobForScan.data?.id as string | null) ?? null,
        commitSha: (latestCompletedScan.data.commit_sha as string) ?? "unknown",
      }
    : null;

  const { t } = await getTranslator("securityTest");

  const report = parseRedTeamReportFromMetadata(latestScanJobForScan.data?.metadata);
  const hypotheses = extractAttackHypothesesFromRedTeamReport(report);
  const availableTests =
    hypotheses.length > 0
      ? buildSecurityTestOptionsFromHypotheses(hypotheses, t)
      : buildDefaultSecurityTestOptions(t);

  const latestCampaignRow = campaigns[0] ?? null;
  const executions = latestCampaignRow
    ? await listAttackExecutionsForCampaign(admin, latestCampaignRow.id, input.organizationId)
    : [];

  const latestCampaign = latestCampaignRow
    ? {
        id: latestCampaignRow.id,
        status: latestCampaignRow.status,
        progressPercent: latestCampaignRow.progressPercent,
        confirmedFindings: latestCampaignRow.confirmedFindings,
        totalExecutions: latestCampaignRow.totalExecutions,
        completedExecutions: latestCampaignRow.completedExecutions,
        commitSha: latestCampaignRow.commitSha,
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
  };
}
