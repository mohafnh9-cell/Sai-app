import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { parseGitHubRepository } from "@/lib/github/repository-service";
import { commitsMatch } from "@/lib/repository-sync/commits-match";
import { getScanSchedulerMode } from "@/lib/env/scan-scheduler";
import { webScansPerRepositoryPerHourLimit } from "@/lib/env/scan-rate-limit";
import { SCAN_JOB_INFRASTRUCTURE_MISSING } from "@/server/jobs/scan-job-infrastructure";
import { ScanEnqueueError } from "@/server/jobs/scan-execution/enqueue-scan-run";
import { ScanJobInfrastructureError } from "@/server/jobs/scan-job-infrastructure";
import { scheduleScanRun } from "@/server/jobs/schedule-scan";
import { mapDatabaseError } from "@/server/security-scanner/admin-client";
import { ScanRequestError } from "@/server/security-scanner/request-context";
import { expireStaleActiveReviewsForRepository } from "@/server/review-recovery/stale-review";
import {
  resolveLatestReviewCommit,
} from "@/server/review-start/resolve-latest-review-commit";
import { releaseActiveReviewForNewHead } from "@/server/review-start/release-active-review-for-new-head";
import { resolveReviewIdempotency } from "@/brain/review-engine/idempotency";

export type StartRepositoryManualScanInput = {
  repositoryId: string;
  scanType?: "full";
  branch?: string;
  forceNew?: boolean;
};

export type StartRepositoryManualScanContext = {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  user: { id: string };
  project: {
    id: string;
    organization_id: string;
    github_repo: string | null;
  };
};

export type StartRepositoryManualScanResult =
  | {
      outcome: "reused";
      scanId: string;
      scan: Record<string, unknown>;
      message: string;
    }
  | {
      outcome: "resumed";
      scanId: string;
      scan: Record<string, unknown>;
      message: string;
    }
  | {
      outcome: "in_progress";
      scan: Record<string, unknown> | null;
    }
  | {
      outcome: "scheduled";
      scanId: string;
      scanJobId: string;
      branch: string | null;
      commitSha: string;
      scan: Record<string, unknown>;
      correlationId: string;
      duplicate: boolean;
    };

export async function startRepositoryManualScan(
  ctx: StartRepositoryManualScanContext,
  input: StartRepositoryManualScanInput
): Promise<StartRepositoryManualScanResult> {
  const repositoryId = input.repositoryId;
  const scanType = input.scanType ?? "full";

  if (!ctx.project.github_repo) {
    throw new ScanRequestError(
      422,
      "GITHUB_REPOSITORY_REQUIRED",
      "Project has no GitHub repository"
    );
  }
  parseGitHubRepository(ctx.project.github_repo);

  const now = Date.now();
  await expireStaleActiveReviewsForRepository(ctx.admin, repositoryId);

  const webScanLimit = webScansPerRepositoryPerHourLimit();
  if (webScanLimit != null) {
    const rateWindow = new Date(now - 60 * 60 * 1000).toISOString();
    const { count: recentScanCount } = await ctx.admin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("repository_id", repositoryId)
      .eq("triggered_by_user_id", ctx.user.id)
      .gte("created_at", rateWindow);
    if ((recentScanCount ?? 0) >= webScanLimit) {
      throw new ScanRequestError(
        429,
        "SCAN_RATE_LIMITED",
        `Maximum of ${webScanLimit} scans per repository per hour reached`
      );
    }
  }

  const { data: projectRow } = await ctx.admin
    .from("projects")
    .select("github_repository_id")
    .eq("id", ctx.project.id)
    .maybeSingle();

  const resolvedCommit = await resolveLatestReviewCommit(ctx.admin, {
    organizationId: ctx.project.organization_id,
    projectId: ctx.project.id,
    githubRepo: ctx.project.github_repo,
    githubRepositoryId: (projectRow?.github_repository_id as number | null) ?? null,
    branch: input.branch ?? null,
  });

  await releaseActiveReviewForNewHead(ctx.admin, {
    organizationId: ctx.project.organization_id,
    projectId: ctx.project.id,
    targetCommitSha: resolvedCommit.commitSha,
    targetBranch: resolvedCommit.branch,
  });

  const idempotency = await resolveReviewIdempotency(ctx.admin, {
    projectId: ctx.project.id,
    commitSha: resolvedCommit.commitSha,
    reviewType: "manual",
    forceNew: input.forceNew === true,
  });

  if (idempotency.action === "reuse_completed") {
    return {
      outcome: "reused",
      scanId: String(idempotency.scan.id),
      scan: idempotency.scan as Record<string, unknown>,
      message: "Review already completed for this commit — reusing existing results.",
    };
  }

  if (idempotency.action === "resume_active") {
    return {
      outcome: "resumed",
      scanId: String(idempotency.scan.id),
      scan: idempotency.scan as Record<string, unknown>,
      message: "Review already in progress for this commit — resuming existing run.",
    };
  }

  let scan: { id: string; [key: string]: unknown } | null = null;
  let insertError: { code?: string; message: string } | null = null;
  const correlationId = randomUUID();

  const scanInsertPayload = {
    organization_id: ctx.project.organization_id,
    project_id: ctx.project.id,
    repository_id: ctx.project.id,
    triggered_by_user_id: ctx.user.id,
    trigger_type: "manual",
    review_type: "manual",
    scan_type: scanType,
    status: "queued",
    progress: 0,
    progress_message: "queued",
    branch: resolvedCommit.branch,
    commit_sha: resolvedCommit.commitSha,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await ctx.supabase.from("scans").insert(scanInsertPayload).select("*").single();
    scan = result.data;
    insertError = result.error;
    if (!insertError) break;

    if (insertError.code !== "23505" || attempt === 1) break;

    const { data: active } = await ctx.supabase
      .from("scans")
      .select("id, status, commit_sha")
      .eq("repository_id", repositoryId)
      .in("status", [
        "queued",
        "fetching_repository",
        "indexing",
        "scanning",
        "calculating_score",
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const activeSha = (active?.commit_sha as string | null) ?? null;
    if (activeSha && commitsMatch(activeSha, resolvedCommit.commitSha)) {
      break;
    }

    await releaseActiveReviewForNewHead(ctx.admin, {
      organizationId: ctx.project.organization_id,
      projectId: ctx.project.id,
      targetCommitSha: resolvedCommit.commitSha,
      targetBranch: resolvedCommit.branch,
    });
  }

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: active } = await ctx.supabase
        .from("scans")
        .select("id, status, progress, progress_message, created_at, commit_sha")
        .eq("repository_id", repositoryId)
        .in("status", [
          "queued",
          "fetching_repository",
          "indexing",
          "scanning",
          "calculating_score",
        ])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return { outcome: "in_progress", scan: (active as Record<string, unknown>) ?? null };
    }
    throw mapDatabaseError(insertError as never, "Could not create scan");
  }

  if (!scan) {
    throw new ScanRequestError(500, "SCAN_CREATE_FAILED", "Could not create scan");
  }

  const { error: stateError } = await ctx.admin.from("repository_scan_state").upsert(
    {
      repository_id: repositoryId,
      organization_id: ctx.project.organization_id,
      active_scan_id: scan.id,
    },
    { onConflict: "repository_id" }
  );
  if (stateError) {
    await ctx.admin
      .from("scans")
      .update({
        status: "failed",
        error_code: "STATE_INITIALIZATION_FAILED",
        error_message: "Could not initialize repository scan state",
        failed_at: new Date().toISOString(),
      })
      .eq("id", scan.id);
    throw mapDatabaseError(stateError, "Could not initialize scan state");
  }

  try {
    const scheduled = await scheduleScanRun(
      ctx.admin,
      {
        scanJobId: "",
        scanId: scan.id,
        organizationId: ctx.project.organization_id,
        projectId: ctx.project.id,
        userId: ctx.user.id,
        branch: resolvedCommit.branch,
        headCommitSha: resolvedCommit.commitSha,
        scanType,
        jobType: "manual_scan",
        correlationId,
      },
      {
        awaitInlineExecution: getScanSchedulerMode() === "inline",
      }
    );

    console.info({
      component: "start-repository-manual-scan",
      event: "production_review_scheduled",
      scanId: scan.id,
      scanJobId: scheduled.scanJobId,
      commitSha: resolvedCommit.commitSha,
      organizationId: ctx.project.organization_id,
      projectId: ctx.project.id,
      correlationId,
      duplicate: scheduled.duplicate,
    });

    return {
      outcome: "scheduled",
      scanId: scan.id,
      scanJobId: scheduled.scanJobId,
      branch: resolvedCommit.branch,
      commitSha: resolvedCommit.commitSha,
      scan: scan as Record<string, unknown>,
      correlationId,
      duplicate: scheduled.duplicate,
    };
  } catch (scheduleError) {
    if (scheduleError instanceof ScanJobInfrastructureError) {
      await ctx.admin
        .from("scans")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          error_code: SCAN_JOB_INFRASTRUCTURE_MISSING,
          error_message: scheduleError.message,
          progress_message: "infrastructureUnavailable",
        })
        .eq("id", scan.id);
      await ctx.admin
        .from("repository_scan_state")
        .update({ active_scan_id: null })
        .eq("repository_id", repositoryId)
        .eq("active_scan_id", scan.id);
      throw scheduleError;
    }
    if (scheduleError instanceof ScanEnqueueError) {
      await ctx.admin
        .from("scans")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          error_code: scheduleError.code,
          error_message: scheduleError.message,
          progress_message: "enqueueFailed",
        })
        .eq("id", scan.id);
      await ctx.admin
        .from("repository_scan_state")
        .update({ active_scan_id: null })
        .eq("repository_id", repositoryId)
        .eq("active_scan_id", scan.id);
      throw scheduleError;
    }
    throw scheduleError;
  }
}
