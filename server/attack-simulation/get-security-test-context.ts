import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedTeamReport } from "@/server/ai-red-team/types";
import {
  buildDefaultSecurityTestOptions,
  buildSecurityTestOptionsFromHypotheses,
} from "./security-test-options";
import type { SecurityTestContext, SecurityTestPhase } from "@/features/security-testing/types";
import {
  buildProgressStepsForPhase,
  copyForPhase,
} from "@/features/security-testing/lib/product-copy";
import { getTranslator } from "@/lib/i18n/server";
import { extractAttackHypothesesFromRedTeamReport } from "./integration/extract-hypotheses-from-report";
import { listAttackCampaignsForProject } from "./persistence/campaign-repository";
import type { AttackHypothesis } from "./contracts/attack-hypothesis";

const TERMINAL_CAMPAIGN = new Set(["completed", "failed", "cancelled"]);

function parseRedTeamReportFromMetadata(metadata: unknown): RedTeamReport | null {
  if (!metadata || typeof metadata !== "object") return null;
  const root = metadata as Record<string, unknown>;
  const platform = (root.platform ?? root.platformConvergence) as Record<string, unknown> | undefined;
  if (!platform) return null;
  const report = platform.report;
  if (!report || typeof report !== "object") return null;
  return report as RedTeamReport;
}

function derivePhase(input: {
  reviewInProgress: boolean;
  latestScan: SecurityTestContext["latestScan"];
  campaign: SecurityTestContext["campaign"];
}): SecurityTestPhase {
  if (input.reviewInProgress) return "preparing";
  if (!input.latestScan) return "needs_review";

  const campaign = input.campaign;
  if (!campaign) return "ready";

  if (!TERMINAL_CAMPAIGN.has(campaign.status)) return "running";

  if (campaign.confirmedFindings > 0) {
    return "issues_found";
  }

  return "completed_clean";
}

export type SecurityTestContextPayload = SecurityTestContext & {
  hypotheses: AttackHypothesis[];
};

export async function getSecurityTestContext(
  admin: SupabaseClient,
  input: { projectId: string; organizationId: string }
): Promise<SecurityTestContextPayload> {
  const attackCenterHref = `/projects/${input.projectId}/attack-center`;

  const [activeScanJob, latestCompletedScan, campaigns] = await Promise.all([
    admin
      .from("scan_jobs")
      .select("id, status")
      .eq("project_id", input.projectId)
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle(),
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

  const reviewInProgress = Boolean(activeScanJob.data);
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

  const latestCampaign = campaigns[0]
    ? {
        id: campaigns[0].id,
        status: campaigns[0].status,
        progressPercent: campaigns[0].progressPercent,
        confirmedFindings: campaigns[0].confirmedFindings,
        totalExecutions: campaigns[0].totalExecutions,
        completedExecutions: campaigns[0].completedExecutions,
        commitSha: campaigns[0].commitSha,
      }
    : null;

  const phase = derivePhase({ reviewInProgress, latestScan, campaign: latestCampaign });
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
