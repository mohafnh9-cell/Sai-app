import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  postGitHubCommitStatus,
  statusFromSecurityCheck,
} from "@/server/github-automation/github-status";
import {
  buildCheckRunExternalId,
  postGitHubCheckRun,
  verdictStatusToCheckConclusion,
} from "@/server/github-automation/github-check-run";
import { finalizeScanAutomation } from "@/server/github-automation/post-scan";
import { resolveOrganizationGitHubToken } from "@/server/github-automation/token-resolver";
import { formatGithubCheckDescription } from "@/brain/production-verdict/build-verdict";
import { buildScanProductionVerdict } from "@/server/brain/build-scan-verdict";
import { getProductionVerdictByScan } from "@/server/production-verdict/service";
import {
  buildIdempotencyKey,
  runIdempotentSideEffect,
} from "@/server/observability/idempotency";

export async function finalizeWebhookAutomationScan(
  admin: SupabaseClient,
  input: {
    scanId: string;
    projectId: string;
    organizationId: string;
    userId: string;
    triggerLabel: string;
    statusSha?: string;
    appUrl?: string;
    pullRequestNumber?: number;
  }
): Promise<{
  checkStatus: "passed" | "failed" | "warning" | "pending";
  productionVerdictId?: string | null;
  githubCheckRunId?: number | null;
  verdictStatus?: string | null;
}> {
  const { data: project } = await admin
    .from("projects")
    .select("github_repo, security_score")
    .eq("id", input.projectId)
    .single();

  if (!project?.github_repo) {
    throw new Error("Project GitHub repository is not connected");
  }

  const { data: completed } = await admin.from("scans").select("*").eq("id", input.scanId).single();
  if (!completed || completed.status !== "completed") {
    throw new Error("Automation scan did not complete");
  }

  const { data: findings } = await admin
    .from("scan_findings")
    .select("category, title, severity, recommendation")
    .eq("scan_id", input.scanId);

  const categoryCounts: Record<string, number> = {};
  for (const row of findings ?? []) {
    const key = row.category.toLowerCase();
    categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
  }

  const { data: previousScan } = await admin
    .from("scans")
    .select("id, critical_count, high_count")
    .eq("project_id", input.projectId)
    .eq("status", "completed")
    .neq("id", input.scanId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousBlockers =
    (previousScan?.critical_count ?? 0) + (previousScan?.high_count ?? 0);
  const currentBlockers =
    (completed.critical_count ?? 0) + (completed.high_count ?? 0);
  const blockersResolved = Math.max(0, previousBlockers - currentBlockers);
  const blockersIntroduced = Math.max(0, currentBlockers - previousBlockers);

  const verdict = await buildScanProductionVerdict(admin, {
    scanId: input.scanId,
    projectId: input.projectId,
    organizationId: input.organizationId,
    securityScore: completed.security_score,
    severityCounts: {
      critical: completed.critical_count ?? 0,
      high: completed.high_count ?? 0,
      medium: completed.medium_count ?? 0,
      low: completed.low_count ?? 0,
      info: completed.info_count ?? 0,
    },
    categoryCounts,
    findings: (findings ?? []).map((row) => ({
      title: row.title,
      severity: row.severity,
      recommendation: row.recommendation,
    })),
  });

  const { checkStatus } = await finalizeScanAutomation(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    securityScore: completed.security_score ?? 0,
    criticalCount: completed.critical_count ?? 0,
    highCount: completed.high_count ?? 0,
    findingsCount: completed.findings_count ?? 0,
    previousScore: project.security_score,
    triggerLabel: input.triggerLabel,
  });

  if (input.statusSha) {
    const tokenResult = await resolveOrganizationGitHubToken(
      admin,
      input.organizationId,
      input.projectId
    );
    if (tokenResult) {
      const reportUrl = input.appUrl
        ? input.pullRequestNumber != null
          ? `${input.appUrl}/projects/${input.projectId}/pull-requests/${input.pullRequestNumber}?head=${input.statusSha}`
          : `${input.appUrl}/projects/${input.projectId}/scans/${input.scanId}`
        : undefined;
      const persistedVerdict = await getProductionVerdictByScan(
        admin,
        input.organizationId,
        input.scanId
      );
      const idempotencyKey = buildIdempotencyKey({
        organizationId: input.organizationId,
        projectId: input.projectId,
        scanId: input.scanId,
        commitSha: input.statusSha,
        operationType: "github_commit_status",
      });
      await runIdempotentSideEffect(
        admin,
        {
          idempotencyKey,
          organizationId: input.organizationId,
          projectId: input.projectId,
          scanId: input.scanId,
          operationType: "github_commit_status",
        },
        async () => {
          await postGitHubCommitStatus({
            githubRepo: project.github_repo,
            sha: input.statusSha!,
            token: tokenResult.token,
            state: statusFromSecurityCheck(checkStatus),
            context: "sequrai/production",
            description: formatGithubCheckDescription({
              verdict,
              blockersIntroduced,
              blockersResolved,
            }),
            targetUrl: reportUrl,
          });
        }
      );

      if (input.pullRequestNumber != null && persistedVerdict) {
        const checkIdempotencyKey = buildIdempotencyKey({
          organizationId: input.organizationId,
          projectId: input.projectId,
          scanId: input.scanId,
          commitSha: input.statusSha,
          operationType: "github_check_run",
        });
        const checkOutcome = await runIdempotentSideEffect(
          admin,
          {
            idempotencyKey: checkIdempotencyKey,
            organizationId: input.organizationId,
            projectId: input.projectId,
            scanId: input.scanId,
            operationType: "github_check_run",
          },
          async () =>
            postGitHubCheckRun({
              githubRepo: project.github_repo,
              sha: input.statusSha!,
              token: tokenResult.token,
              conclusion: verdictStatusToCheckConclusion(persistedVerdict.status, {
                checkStatus,
              }),
              verdict: persistedVerdict,
              reportUrl,
              pullRequestNumber: input.pullRequestNumber,
              externalId: buildCheckRunExternalId({
                pullRequestNumber: input.pullRequestNumber!,
                headSha: input.statusSha!,
              }),
            })
        );

        const { data: verdictRow } = await admin
          .from("production_verdicts")
          .select("id")
          .eq("scan_id", input.scanId)
          .maybeSingle();

        return {
          checkStatus,
          productionVerdictId: (verdictRow?.id as string | undefined) ?? null,
          githubCheckRunId: checkOutcome.result?.checkRunId ?? null,
          verdictStatus: persistedVerdict.status,
        };
      }
    }
  }

  const persisted = await getProductionVerdictByScan(admin, input.organizationId, input.scanId);
  const { data: verdictRow } = await admin
    .from("production_verdicts")
    .select("id")
    .eq("scan_id", input.scanId)
    .maybeSingle();

  return {
    checkStatus,
    productionVerdictId: (verdictRow?.id as string | undefined) ?? null,
    githubCheckRunId: null,
    verdictStatus: persisted?.status ?? verdict.status,
  };
}
