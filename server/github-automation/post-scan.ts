import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { runAISecurityAnalysis } from "@/server/ai-security-engine/pipeline";
import {
  recordRepositoryActivity,
  recordTimelineEvent,
  updateRepositoryHealth,
} from "./activity";
import { calculateRepositoryHealth, securityCheckStatus } from "./health";
import { notifyOrganizationMembers } from "./notifications";
import { generateAndPersistProductionVerdict } from "@/server/production-verdict/service";

export async function finalizeScanAutomation(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    securityScore: number;
    criticalCount: number;
    highCount: number;
    findingsCount: number;
    previousScore: number | null;
    triggerLabel: string;
  }
) {
  const { organizationId, projectId } = input;
  const scoreDelta =
    input.previousScore === null ? 0 : input.securityScore - input.previousScore;
  const checkStatus = securityCheckStatus({
    securityScore: input.securityScore,
    criticalCount: input.criticalCount,
    highCount: input.highCount,
  });
  const { status: healthStatus, factors } = calculateRepositoryHealth({
    securityScore: input.securityScore,
    openFindings: input.findingsCount,
    criticalOpen: input.criticalCount,
    scoreTrend: scoreDelta,
  });

  await updateRepositoryHealth(admin, {
    organizationId,
    projectId,
    healthStatus,
    securityScore: input.securityScore,
    openFindings: input.findingsCount,
    criticalOpen: input.criticalCount,
    scoreTrend: scoreDelta,
    factors,
  });

  try {
    await generateAndPersistProductionVerdict(admin, {
      organizationId,
      projectId,
      scanId: input.scanId,
    });
  } catch (error) {
    console.info("verdict_generation_skipped", {
      scanId: input.scanId,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }

  await recordRepositoryActivity(admin, {
    organizationId,
    projectId,
    scanId: input.scanId,
    eventType: "scan_completed",
    title: "GitHub push analyzed",
    description: `${input.criticalCount + input.highCount} production blocker${input.criticalCount + input.highCount === 1 ? "" : "s"} · Production score ${input.securityScore}`,
    metadata: { securityScore: input.securityScore, checkStatus },
  });

  await recordTimelineEvent(admin, {
    organizationId,
    projectId,
    scanId: input.scanId,
    eventType: "incremental_scan_completed",
    title: "GitHub push analyzed",
    description: input.triggerLabel,
    securityScore: input.securityScore,
    metadata: { scoreDelta, checkStatus },
  });

  await notifyOrganizationMembers(admin, organizationId, {
    projectId,
    scanId: input.scanId,
    notificationType: "scan_completed",
    title: "GitHub push analyzed",
    body: `${input.triggerLabel}: production score ${input.securityScore}, ${input.criticalCount + input.highCount} blocker${input.criticalCount + input.highCount === 1 ? "" : "s"}.`,
    severity: input.criticalCount > 0 ? "critical" : "info",
    metadata: { scanId: input.scanId, checkStatus },
  });

  if (input.criticalCount > 0) {
    await notifyOrganizationMembers(admin, organizationId, {
      projectId,
      notificationType: "critical_finding",
      title: "Production blocker detected",
      body: `${input.criticalCount} critical blocker${input.criticalCount === 1 ? "" : "s"} found after ${input.triggerLabel}.`,
      severity: "critical",
      metadata: { scanId: input.scanId },
    });
  } else if (scoreDelta < -5) {
    await notifyOrganizationMembers(admin, organizationId, {
      projectId,
      notificationType: "score_decreased",
      title: "Production score decreased",
      body: `Score dropped by ${Math.abs(scoreDelta)} points after ${input.triggerLabel}.`,
      severity: "warning",
      metadata: { scanId: input.scanId, scoreDelta },
    });
  } else if (scoreDelta > 0) {
    await recordTimelineEvent(admin, {
      organizationId,
      projectId,
      scanId: input.scanId,
      eventType: "score_increased",
      title: `Production score increased by ${scoreDelta} points`,
      securityScore: input.securityScore,
      metadata: { scoreDelta },
    });
  }

  if (input.triggerLabel.includes("Pull Request")) {
    await notifyOrganizationMembers(admin, organizationId, {
      projectId,
      notificationType: "pull_request_analyzed",
      title: "Pull request analyzed",
      body: `Production score: ${input.securityScore}. Status: ${checkStatus}.`,
      severity: checkStatus === "failed" ? "critical" : "info",
      metadata: { scanId: input.scanId, checkStatus },
    });
  }

  try {
    await runAISecurityAnalysis(admin, input.scanId);
    await recordRepositoryActivity(admin, {
      organizationId,
      projectId,
      scanId: input.scanId,
      eventType: "ai_analysis_completed",
      title: "Production insights updated",
      description: "Priorities, fixes, and recommendations updated.",
    });
  } catch (error) {
    console.info("post_scan_ai_skipped", {
      scanId: input.scanId,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }

  return { checkStatus, healthStatus, scoreDelta };
}
