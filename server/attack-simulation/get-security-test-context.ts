import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedTeamReport } from "@/server/ai-red-team/types";
import {
  buildDefaultSecurityTestOptions,
  buildSecurityTestOptionsFromHypotheses,
} from "./security-test-options";
import type {
  SecurityTestContext,
  SecurityTestPhase,
  SecurityTestProgressStep,
} from "@/features/security-testing/types";
import { extractAttackHypothesesFromRedTeamReport } from "./integration/extract-hypotheses-from-report";
import { listAttackCampaignsForProject } from "./persistence/campaign-repository";
import type { AttackHypothesis } from "./contracts/attack-hypothesis";

const TERMINAL_CAMPAIGN = new Set(["completed", "failed", "cancelled"]);

function buildProgressSteps(phase: SecurityTestPhase): SecurityTestProgressStep[] {
  const stepFor = (id: SecurityTestProgressStep["id"], current: SecurityTestPhase): SecurityTestProgressStep["status"] => {
    const order: SecurityTestPhase[] = [
      "needs_review",
      "preparing",
      "ready",
      "running",
      "issues_found",
      "fix_ready",
      "protected",
      "completed_clean",
    ];
    const idx = order.indexOf(current);
    const chooseIdx = order.indexOf("ready");
    const runIdx = order.indexOf("running");
    const fixIdx = order.indexOf("issues_found");
    const verifyIdx = order.indexOf("protected");

    if (id === "choose") {
      if (idx >= runIdx) return "done";
      if (idx >= chooseIdx) return "current";
      return "upcoming";
    }
    if (id === "run") {
      if (idx >= fixIdx || idx === order.indexOf("completed_clean")) return "done";
      if (idx >= runIdx) return "current";
      return "upcoming";
    }
    if (id === "fix") {
      if (idx >= verifyIdx || idx === order.indexOf("completed_clean")) return "done";
      if (idx >= fixIdx) return "current";
      return "upcoming";
    }
    if (idx === order.indexOf("protected") || idx === order.indexOf("completed_clean")) return "done";
    if (idx >= fixIdx) return "current";
    return "upcoming";
  };

  return [
    { id: "choose", label: "Choose tests", status: stepFor("choose", phase) },
    { id: "run", label: "Run safe attacks", status: stepFor("run", phase) },
    { id: "fix", label: "Fix problems", status: stepFor("fix", phase) },
    { id: "verify", label: "Verify protection", status: stepFor("verify", phase) },
  ];
}

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

function copyForPhase(phase: SecurityTestPhase): Pick<
  SecurityTestContext,
  "headline" | "description" | "primaryActionLabel" | "secondaryActionLabel"
> {
  switch (phase) {
    case "needs_review":
      return {
        headline: "Test my application",
        description:
          "SequrAI will safely simulate attacks against this version of your application.",
        primaryActionLabel: "Test my application",
        secondaryActionLabel: null,
      };
    case "preparing":
      return {
        headline: "Preparing your security test",
        description: "We are reviewing your code and selecting safe attack scenarios.",
        primaryActionLabel: "Preparing…",
        secondaryActionLabel: null,
      };
    case "ready":
      return {
        headline: "Ready to test your application",
        description:
          "SequrAI will safely simulate attacks against this version of your application.",
        primaryActionLabel: "Test my application",
        secondaryActionLabel: "Choose tests",
      };
    case "running":
      return {
        headline: "Security test in progress",
        description: "Safe attacks are running now. You can watch live progress at any time.",
        primaryActionLabel: "View live test",
        secondaryActionLabel: null,
      };
    case "issues_found":
      return {
        headline: "We found issues that need protection",
        description: "Some simulated attacks succeeded. Review findings and apply protection.",
        primaryActionLabel: "Protect my application",
        secondaryActionLabel: "View live test",
      };
    case "fix_ready":
      return {
        headline: "Protection is ready to apply",
        description: "SequrAI prepared fixes for the issues found during testing.",
        primaryActionLabel: "Apply protection",
        secondaryActionLabel: "View live test",
      };
    case "protected":
      return {
        headline: "Protection verified",
        description: "Your fixes were replayed and the simulated attacks no longer succeed.",
        primaryActionLabel: "View results",
        secondaryActionLabel: "Test again",
      };
    case "completed_clean":
      return {
        headline: "No successful attacks in this test",
        description: "The simulated attacks did not find exploitable issues in this version.",
        primaryActionLabel: "View results",
        secondaryActionLabel: "Test again",
      };
  }
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

  const report = parseRedTeamReportFromMetadata(latestScanJobForScan.data?.metadata);
  const hypotheses = extractAttackHypothesesFromRedTeamReport(report);
  const availableTests =
    hypotheses.length > 0
      ? buildSecurityTestOptionsFromHypotheses(hypotheses)
      : buildDefaultSecurityTestOptions();

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
  const copy = copyForPhase(phase);

  return {
    phase,
    ...copy,
    reviewInProgress,
    latestScan,
    campaign: latestCampaign,
    availableTests,
    progressSteps: buildProgressSteps(phase),
    attackCenterHref,
    hypotheses,
  };
}
