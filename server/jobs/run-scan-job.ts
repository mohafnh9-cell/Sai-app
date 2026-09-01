import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isActiveReviewScanStatus } from "@/brain/automatic-review/review-status";
import { isScanCancellationTerminal } from "@/lib/review/cancellation";
import { InlineScanJobRunner } from "@/server/security-scanner/scan-job-runner";
import { resolveOrganizationGitHubToken } from "@/server/github-automation/token-resolver";
import {
  getScanJob,
  markScanJobCompleted,
  markScanJobFailed,
  markScanJobCancelled,
  markScanJobRunning,
  touchScanJobHeartbeat,
} from "./scan-job-store";
import type { ScanRunPayload } from "./types";
import { isTerminalScanJobStatus } from "./job-transitions";
import { finalizeWebhookAutomationScan } from "./finalize-webhook-scan";
import { invalidateProjectCache } from "@/server/cache/read-cache";
import { finalizeAutomaticReviewJob } from "./finalize-automatic-review-job";
import { emitOperationalEvent } from "@/server/observability/operational-events";
import { ScanCancelledError } from "@/server/review-cancel/review-abort";
import { beginReviewProcessing } from "./scan-execution/review-lifecycle";
import { alignScanWithRemoteHead } from "@/server/repository-sync/github-sync-snapshot";
import { GitHubRepositoryService } from "@/lib/github/repository-service";
import {
  appendScanJobExecutionTrace,
  logScanExecutionTrace,
} from "./scan-execution/scan-execution-trace";
import { ensureProductionVerdictForCompletedScan } from "@/server/production-verdict/ensure-verdict-for-scan";
import { startScanJobHeartbeat } from "./scan-job-heartbeat";

function log(level: "info" | "error", event: string, fields: Record<string, unknown>) {
  const payload = { component: "run-scan-job", event, ...fields };
  if (level === "error") console.error(payload);
  else console.info(payload);
}

export async function executeScanRunJob(
  admin: SupabaseClient,
  payload: ScanRunPayload,
  input?: {
    inngestRunId?: string;
    attempt?: number;
    lockedBy?: string;
    /**
     * Skip the queued->running claim. Only safe when the caller has already
     * independently verified the underlying scan is `completed` (recovery's
     * reconciliation path) -- a job stuck at status "running" can never win
     * that claim (ALLOWED_SOURCE_STATUSES.running only permits "queued" as
     * the source status), so without this the job loops as a permanent
     * no-op ("scan_job_already_running") instead of ever finalizing.
     */
    reconcileOnly?: boolean;
  }
): Promise<void> {
  let runPayload = payload;
  const existingJob = await getScanJob(admin, payload.scanJobId);
  if (existingJob && isTerminalScanJobStatus(existingJob.status)) {
    if (existingJob.status === "completed") {
      const { data: terminalScan } = await admin
        .from("scans")
        .select("status")
        .eq("id", payload.scanId)
        .maybeSingle();
      if (
        terminalScan?.status === "completed" &&
        payload.persistMode !== "review_only"
      ) {
        await ensureProductionVerdictForCompletedScan(admin, {
          organizationId: payload.organizationId,
          projectId: payload.projectId,
          scanId: payload.scanId,
          scanJobId: payload.scanJobId,
        });
      }
    }
    log("info", "scan_job_already_terminal", {
      scanJobId: payload.scanJobId,
      status: existingJob.status,
    });
    return;
  }

  const { data: scanBeforeRun } = await admin
    .from("scans")
    .select("status, commit_sha")
    .eq("id", payload.scanId)
    .maybeSingle();

  if (scanBeforeRun?.status && isScanCancellationTerminal(scanBeforeRun.status as string)) {
    await markScanJobCancelled(admin, payload.scanJobId, {
      failureCode: "USER_CANCELLED",
      failureMessage: "Review cancelled by user",
    });
    log("info", "scan_worker_stopped_cancelled_review", {
      scanJobId: payload.scanJobId,
      scanId: payload.scanId,
      reviewStatus: scanBeforeRun.status,
    });
    return;
  }

  if (
    scanBeforeRun?.status &&
    !isActiveReviewScanStatus(scanBeforeRun.status as string) &&
    scanBeforeRun.status !== "completed"
  ) {
    await markScanJobFailed(admin, payload.scanJobId, {
      failureCode: "STALE_WORKER_REJECTED",
      failureMessage: `Review is no longer active (status ${scanBeforeRun.status})`,
    });
    log("info", "scan_worker_rejected_stale_review", {
      scanJobId: payload.scanJobId,
      scanId: payload.scanId,
      reviewStatus: scanBeforeRun.status,
    });
    return;
  }

  const jobAfterClaimPreview = existingJob;
  const schedulerPreview =
    (jobAfterClaimPreview?.metadata as { scheduler?: string } | null)?.scheduler ??
    input?.lockedBy ??
    null;

  if (scanBeforeRun?.status === "queued") {
    const started = await beginReviewProcessing(admin, {
      reviewId: payload.scanId,
      scanJobId: payload.scanJobId,
      organizationId: payload.organizationId,
      projectId: payload.projectId,
      commitSha: (scanBeforeRun.commit_sha as string | null) ?? payload.headCommitSha ?? null,
      scheduler: schedulerPreview,
    });
    log("info", "scan_worker_begin_processing", {
      scanJobId: payload.scanJobId,
      scanId: payload.scanId,
      started,
    });
  }

  const running = input?.reconcileOnly
    ? { updated: true }
    : await markScanJobRunning(admin, payload.scanJobId, {
        inngestRunId: input?.inngestRunId,
        attemptCount: input?.attempt ?? undefined,
        lockedBy: input?.lockedBy,
      });
  if (!running.updated) {
    const current = await getScanJob(admin, payload.scanJobId);
    if (current && isTerminalScanJobStatus(current.status)) return;
    if (current?.status === "running") {
      log("info", "scan_job_already_running", {
        scanJobId: payload.scanJobId,
        scanId: payload.scanId,
        lockedBy: current.locked_by,
        inngestRunId: current.inngest_run_id,
      });
      return;
    }
  }

  const jobAfterClaim = (await getScanJob(admin, payload.scanJobId)) ?? existingJob;
  const scheduler =
    (jobAfterClaim?.metadata as { scheduler?: string } | null)?.scheduler ?? input?.lockedBy ?? null;

  await appendScanJobExecutionTrace(admin, payload.scanJobId, {
    stage: "scan_started",
    at: new Date().toISOString(),
    scheduler: (scheduler as "inline" | "inngest" | null) ?? null,
  });
  logScanExecutionTrace("scan_started", {
    reviewId: payload.scanId,
    scanJobId: payload.scanJobId,
    projectId: payload.projectId,
    organizationId: payload.organizationId,
    commitSha: (scanBeforeRun?.commit_sha as string | null) ?? payload.headCommitSha ?? null,
    scheduler,
    status: scanBeforeRun?.status ?? null,
    stage: "scan_started",
  });

  if (scanBeforeRun?.status !== "completed") {
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
  const github = new GitHubRepositoryService(tokenResult.token);
  const stopHeartbeat = startScanJobHeartbeat(admin, payload.scanJobId);

  try {
    const githubRepo = await loadGithubRepo(admin, payload.projectId);
    const aligned = await alignScanWithRemoteHead(admin, {
      organizationId: payload.organizationId,
      projectId: payload.projectId,
      scanId: payload.scanId,
      githubRepo,
      branch: payload.branch ?? null,
      expectedCommitSha:
        (scanBeforeRun?.commit_sha as string | null) ?? payload.headCommitSha ?? null,
      githubService: github,
    });
    if (aligned) {
      runPayload = {
        ...runPayload,
        headCommitSha: aligned.commitSha,
        branch: aligned.branch,
      };
    } else {
      const pinned =
        (scanBeforeRun?.commit_sha as string | null) ?? runPayload.headCommitSha ?? null;
      if (pinned) {
        runPayload = { ...runPayload, headCommitSha: pinned };
      }
    }

    if (!runPayload.headCommitSha) {
      await markScanJobFailed(admin, payload.scanJobId, {
        failureCode: "REVIEW_COMMIT_UNRESOLVED",
        failureMessage: "Production Review has no target commit SHA",
      });
      throw new Error("REVIEW_COMMIT_UNRESOLVED");
    }

    await touchScanJobHeartbeat(admin, payload.scanJobId);
    await runner.run({
      scanId: runPayload.scanId,
      scanJobId: runPayload.scanJobId,
      repositoryId: runPayload.projectId,
      organizationId: runPayload.organizationId,
      githubRepo,
      branch: runPayload.branch,
      providerToken: tokenResult.token,
      scanType: runPayload.scanType,
      baseCommitSha: runPayload.baseCommitSha,
      headCommitSha: runPayload.headCommitSha,
      persistMode: runPayload.persistMode,
      githubService: github,
    });
  } catch (error) {
    if (error instanceof ScanCancelledError) {
      await markScanJobCancelled(admin, payload.scanJobId, {
        failureCode: "USER_CANCELLED",
        failureMessage: "Review cancelled by user",
      });
      log("info", "scan_execution_aborted_cancelled", {
        scanJobId: payload.scanJobId,
        scanId: payload.scanId,
      });
      return;
    }
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
  } finally {
    stopHeartbeat();
    github.dispose();
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

  if (completed?.status === "cancelled" || completed?.status === "cancelling") {
    await markScanJobCancelled(admin, payload.scanJobId, {
      failureCode: "USER_CANCELLED",
      failureMessage: "Review cancelled by user",
    });
    log("info", "scan_job_finished_after_cancel", {
      scanJobId: payload.scanJobId,
      scanId: payload.scanId,
      reviewStatus: completed.status,
    });
    return;
  }

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
        const finalizeResult = await finalizeWebhookAutomationScan(admin, {
          scanId: payload.scanId,
          projectId: payload.projectId,
          organizationId: payload.organizationId,
          userId: payload.userId,
          triggerLabel: `Pull Request #${payload.finalize.pullRequestNumber}`,
          statusSha: payload.finalize.headSha,
          appUrl: payload.finalize.appUrl,
          pullRequestNumber: payload.finalize.pullRequestNumber,
        });
        await finalizePullRequestScan(admin, payload, finalizeResult);
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
  if (completedTransition.updated) {
    log("info", "scan_job_completed", {
      scanJobId: payload.scanJobId,
      scanId: payload.scanId,
      organizationId: payload.organizationId,
      projectId: payload.projectId,
    });
  } else {
    log("info", "scan_job_complete_noop", { scanJobId: payload.scanJobId });
  }

  if (payload.persistMode !== "review_only") {
    await ensureProductionVerdictForCompletedScan(admin, {
      organizationId: payload.organizationId,
      projectId: payload.projectId,
      scanId: payload.scanId,
      scanJobId: payload.scanJobId,
    });
  }

  await appendScanJobExecutionTrace(admin, payload.scanJobId, {
    stage: "verdict_persisted",
    at: new Date().toISOString(),
    scheduler: (scheduler as "inline" | "inngest" | null) ?? null,
  });
  logScanExecutionTrace("verdict_persisted", {
    reviewId: payload.scanId,
    scanJobId: payload.scanJobId,
    projectId: payload.projectId,
    organizationId: payload.organizationId,
    scheduler,
    status: "completed",
    stage: "verdict_persisted",
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
  finalizeResult: {
    checkStatus: "passed" | "failed" | "warning" | "pending";
    productionVerdictId?: string | null;
    githubCheckRunId?: number | null;
    verdictStatus?: string | null;
  }
) {
  if (payload.finalize?.kind !== "webhook_pr") return;
  const finalize = payload.finalize;
  const checkStatus = finalizeResult.checkStatus;
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
      production_verdict_id: finalizeResult.productionVerdictId ?? null,
      github_check_run_id: finalizeResult.githubCheckRunId ?? null,
      verdict_status: finalizeResult.verdictStatus ?? null,
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
