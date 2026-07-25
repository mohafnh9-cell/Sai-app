import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { InlineScanJobRunner } from "@/server/security-scanner/scan-job-runner";
import { resolveOrganizationGitHubToken } from "@/server/github-automation/token-resolver";
import {
  getScanJob,
  markScanJobCompleted,
  markScanJobFailed,
  markScanJobRunning,
  touchScanJobHeartbeat,
} from "./scan-job-store";
import type { ScanRunPayload } from "./types";
import { isTerminalScanJobStatus } from "./job-transitions";
import { finalizeWebhookAutomationScan } from "./finalize-webhook-scan";
import { invalidateProjectCache } from "@/server/cache/read-cache";
import { finalizeAutomaticReviewJob } from "./finalize-automatic-review-job";
import { emitOperationalEvent } from "@/server/observability/operational-events";

function log(level: "info" | "error", event: string, fields: Record<string, unknown>) {
  const payload = { component: "run-scan-job", event, ...fields };
  if (level === "error") console.error(payload);
  else console.info(payload);
}

export async function executeScanRunJob(
  admin: SupabaseClient,
  payload: ScanRunPayload,
  input?: { inngestRunId?: string; attempt?: number }
): Promise<void> {
  const existingJob = await getScanJob(admin, payload.scanJobId);
  if (existingJob && isTerminalScanJobStatus(existingJob.status)) {
    log("info", "scan_job_already_terminal", {
      scanJobId: payload.scanJobId,
      status: existingJob.status,
    });
    return;
  }

  const running = await markScanJobRunning(admin, payload.scanJobId, {
    inngestRunId: input?.inngestRunId,
    attemptCount: input?.attempt ?? undefined,
  });
  if (!running.updated) {
    const current = await getScanJob(admin, payload.scanJobId);
    if (current && isTerminalScanJobStatus(current.status)) return;
  }

  const { data: scanBeforeRun } = await admin
    .from("scans")
    .select("status")
    .eq("id", payload.scanId)
    .maybeSingle();

  const tokenResult = await resolveOrganizationGitHubToken(
    admin,
    payload.organizationId,
    payload.projectId
  );

  if (!tokenResult) {
    await markScanJobFailed(admin, payload.scanJobId, {
      failureCode: "GITHUB_TOKEN_UNAVAILABLE",
      failureMessage: "No GitHub token available for workspace",
    });
    throw new Error("GITHUB_TOKEN_UNAVAILABLE");
  }

  const runner = new InlineScanJobRunner(admin);

  if (scanBeforeRun?.status !== "completed") {
    try {
      await touchScanJobHeartbeat(admin, payload.scanJobId);
      await runner.run({
        scanId: payload.scanId,
        repositoryId: payload.projectId,
        organizationId: payload.organizationId,
        githubRepo: await loadGithubRepo(admin, payload.projectId),
        branch: payload.branch,
        providerToken: tokenResult.token,
        scanType: payload.scanType,
        baseCommitSha: payload.baseCommitSha,
        headCommitSha: payload.headCommitSha,
        persistMode: payload.persistMode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scan execution failed";
      await markScanJobFailed(admin, payload.scanJobId, {
        failureCode: "SCAN_EXECUTION_FAILED",
        failureMessage: message,
      });
      log("error", "scan_execution_failed", {
        scanJobId: payload.scanJobId,
        scanId: payload.scanId,
        organizationId: payload.organizationId,
        projectId: payload.projectId,
        message,
      });
      throw error;
    }
  } else {
    log("info", "scan_runner_skipped_already_completed", {
      scanJobId: payload.scanJobId,
      scanId: payload.scanId,
    });
  }

  const { data: completed } = await admin
    .from("scans")
    .select("status")
    .eq("id", payload.scanId)
    .single();

  if (completed?.status !== "completed") {
    await markScanJobFailed(admin, payload.scanJobId, {
      failureCode: "SCAN_DID_NOT_COMPLETE",
      failureMessage: `Scan ended with status ${completed?.status ?? "unknown"}`,
    });
    throw new Error("SCAN_DID_NOT_COMPLETE");
  }

  if (payload.finalize) {
    const jobBeforeFinalize = await getScanJob(admin, payload.scanJobId);
    if (jobBeforeFinalize?.metadata?.finalizeCompleted === true) {
      log("info", "scan_finalize_skipped_already_completed", {
        scanJobId: payload.scanJobId,
        scanId: payload.scanId,
      });
    } else {
    try {
      if (payload.finalize.kind === "webhook_automation") {
        await finalizeWebhookAutomationScan(admin, {
          scanId: payload.scanId,
          projectId: payload.projectId,
          organizationId: payload.organizationId,
          userId: payload.userId,
          triggerLabel: payload.finalize.triggerLabel,
          statusSha: payload.finalize.statusSha,
          appUrl: payload.finalize.appUrl,
        });
        if (payload.finalize.incremental) {
          await recordIncrementalScan(admin, payload, payload.finalize.incremental);
        }
      } else if (payload.finalize.kind === "webhook_pr") {
        const { checkStatus } = await finalizeWebhookAutomationScan(admin, {
          scanId: payload.scanId,
          projectId: payload.projectId,
          organizationId: payload.organizationId,
          userId: payload.userId,
          triggerLabel: `Pull Request #${payload.finalize.pullRequestNumber}`,
          statusSha: payload.finalize.headSha,
          appUrl: payload.finalize.appUrl,
        });
        await finalizePullRequestScan(admin, payload, checkStatus);
      } else if (payload.finalize.kind === "automatic_review") {
        await finalizeAutomaticReviewJob(admin, {
          organizationId: payload.organizationId,
          projectId: payload.projectId,
          scanId: payload.scanId,
        });
      } else if (payload.finalize.kind === "incremental_record") {
        await recordIncrementalScan(admin, payload, {
          baseSha: payload.finalize.baseSha,
          headSha: payload.finalize.headSha,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Finalize step failed";
      await markScanJobFailed(admin, payload.scanJobId, {
        failureCode: "SCAN_FINALIZE_FAILED",
        failureMessage: message,
      });
      log("error", "scan_finalize_failed", {
        scanJobId: payload.scanJobId,
        scanId: payload.scanId,
        organizationId: payload.organizationId,
        projectId: payload.projectId,
        message,
      });
      throw error;
    }
    await admin
      .from("scan_jobs")
      .update({
        metadata: {
          ...(jobBeforeFinalize?.metadata ?? {}),
          finalizeCompleted: true,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.scanJobId);
    }
  }

  const completedTransition = await markScanJobCompleted(admin, payload.scanJobId);
  if (!completedTransition.updated) {
    log("info", "scan_job_complete_noop", { scanJobId: payload.scanJobId });
    return;
  }
  log("info", "scan_job_completed", {
    scanJobId: payload.scanJobId,
    scanId: payload.scanId,
    organizationId: payload.organizationId,
    projectId: payload.projectId,
  });
  invalidateProjectCache(payload.projectId);
}

async function loadGithubRepo(admin: SupabaseClient, projectId: string): Promise<string> {
  const { data, error } = await admin
    .from("projects")
    .select("github_repo")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data?.github_repo) {
    throw new Error("Project GitHub repository is not connected");
  }
  return data.github_repo;
}

async function recordIncrementalScan(
  admin: SupabaseClient,
  payload: ScanRunPayload,
  incremental: { baseSha: string; headSha: string }
) {
  const { data: completed } = await admin
    .from("scans")
    .select("metrics")
    .eq("id", payload.scanId)
    .single();
  const changedPaths =
    (completed?.metrics as { changedPaths?: string[] } | null)?.changedPaths ?? [];
  const { extractCriticalPaths } = await import("@/server/github-automation/health");
  await admin.from("incremental_scans").insert({
    organization_id: payload.organizationId,
    project_id: payload.projectId,
    scan_id: payload.scanId,
    base_commit_sha: incremental.baseSha,
    head_commit_sha: incremental.headSha,
    changed_files: changedPaths,
    critical_files_changed: extractCriticalPaths(changedPaths),
  });
}

async function finalizePullRequestScan(
  admin: SupabaseClient,
  payload: ScanRunPayload,
  checkStatus: "passed" | "failed" | "warning" | "pending"
) {
  if (payload.finalize?.kind !== "webhook_pr") return;
  const finalize = payload.finalize;
  const { data: completed } = await admin
    .from("scans")
    .select("security_score")
    .eq("id", payload.scanId)
    .single();
  const scoreAfter = completed?.security_score ?? 0;
  const scoreBefore = finalize.scoreBefore;
  const scoreDelta = scoreBefore === null ? 0 : scoreAfter - scoreBefore;

  const { data: prFindings } = await admin
    .from("scan_findings")
    .select("title, severity")
    .eq("scan_id", payload.scanId);

  const added = (prFindings ?? [])
    .filter((f) => f.severity !== "info")
    .slice(0, 5)
    .map((f) => f.title);

  await admin.from("pull_request_scans").upsert(
    {
      organization_id: payload.organizationId,
      project_id: payload.projectId,
      scan_id: payload.scanId,
      pull_request_number: finalize.pullRequestNumber,
      pull_request_title: finalize.pullRequestTitle,
      base_branch: finalize.baseBranch,
      head_branch: finalize.headBranch,
      base_commit_sha: finalize.baseSha,
      head_commit_sha: finalize.headSha,
      security_score_before: scoreBefore,
      security_score_after: scoreAfter,
      score_delta: scoreDelta,
      check_status: checkStatus,
      impact_summary: {
        scoreDelta,
        added,
        resolved: [],
        checkStatus,
        securityScore: scoreAfter,
      },
    },
    { onConflict: "project_id,pull_request_number,head_commit_sha" }
  );
}
