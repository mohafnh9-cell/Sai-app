import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideReviewNowAction } from "@/brain/review-now/decision";
import { hasActiveRepositoryReview } from "@/server/automatic-review/queries";
import { resolveOrganizationGitHubToken } from "@/server/github-automation/token-resolver";
import {
  GitHubServiceError,
  parseGitHubRepository,
  resolveCommitReference,
  type GitHubRepositoryRef,
  type ResolvedCommitReference,
} from "@/lib/github/repository-service";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { scheduleScanRun } from "@/server/jobs/schedule-scan";
import { recoverStaleActiveReviewsForProject } from "@/server/review-recovery/stale-review";
import { recordLiveHeadCommit } from "@/server/repository-sync/persistence";
import { releaseActiveReviewForNewHead } from "@/server/review-start/release-active-review-for-new-head";

export type ResolveGitHubTokenFn = (
  admin: SupabaseClient,
  organizationId: string
) => Promise<{ token: string; userId: string } | null>;

export type ResolveCommitFn = (
  token: string,
  ref: GitHubRepositoryRef,
  input: { commitSha?: string; branch?: string }
) => Promise<ResolvedCommitReference>;

export type RunScanFn = (context: {
  scanJobId: string;
  scanId: string;
  organizationId: string;
  projectId: string;
  userId: string;
  scanType?: "full" | "incremental";
  branch?: string;
  headCommitSha?: string;
}) => Promise<void>;

export class ReviewNowError extends Error {
  constructor(
    public readonly code:
      | "repository_disconnected"
      | "invalid_commit"
      | "commit_not_found"
      | "review_creation_failed"
      | "internal_error",
    message: string
  ) {
    super(message);
    this.name = "ReviewNowError";
  }
}

export type TriggerReviewInput = {
  organizationId: string;
  projectId: string;
  githubRepo: string | null;
  githubRepositoryId: number | null;
  requestedCommitSha?: string;
  requestedBranch?: string;
};

/**
 * Schedules work to continue after the MCP response has been sent. Defaults
 * to Next.js's `after()`. Injectable so unit tests can assert a review was
 * queued for background execution without requiring a real Next.js request
 * scope or hitting the real GitHub API / scanner.
 */
export type BackgroundScheduler = (fn: () => void | Promise<void>) => void;

const defaultScheduler: BackgroundScheduler = (fn) => {
  after(fn);
};

export type TriggerReviewResult =
  | {
      outcome: "queued";
      reviewId: string;
      commitSha: string;
      branch: string | null;
      createdAt: string;
    }
  | {
      outcome: "processing";
      reviewId: string;
    }
  | {
      outcome: "already_completed";
      reviewId: string | null;
      verdictStatus: string;
      score: number | null;
      reviewedCommitSha: string;
    };

const ACTIVE_SCAN_STATUSES = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
];

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "review-now", event, ...fields });
}

async function loadActiveScanId(admin: SupabaseClient, projectId: string): Promise<string | null> {
  const { data } = await admin
    .from("scans")
    .select("id")
    .eq("repository_id", projectId)
    .in("status", ACTIVE_SCAN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * ADR-001 / MCP V1 review_now: this function only authorizes, resolves the
 * project/repository/commit, and starts the *existing* Production Review
 * pipeline (InlineScanJobRunner → generateAndPersistProductionVerdict). It
 * never computes score, status, blockers, or a deployment recommendation —
 * those remain exclusively the Production Verdict Engine's output, read back
 * afterwards through can_i_deploy. This is the same pipeline used by manual
 * web reviews (identical persistMode / verdict persistence behavior); no
 * second scanner is created.
 */
export type TriggerReviewDependencies = {
  scheduleBackground?: BackgroundScheduler;
  resolveToken?: ResolveGitHubTokenFn;
  resolveCommit?: ResolveCommitFn;
  runScan?: RunScanFn;
};

export async function triggerProductionReview(
  admin: SupabaseClient,
  input: TriggerReviewInput,
  deps: TriggerReviewDependencies = {}
): Promise<TriggerReviewResult> {
  const scheduleBackground = deps.scheduleBackground ?? defaultScheduler;
  const resolveToken =
    deps.resolveToken ??
    ((admin, organizationId) =>
      resolveOrganizationGitHubToken(admin, organizationId, input.projectId));
  const resolveCommit = deps.resolveCommit ?? resolveCommitReference;
  const runScan =
    deps.runScan ??
    (async (context) => {
      await scheduleScanRun(
        admin,
        {
          scanJobId: context.scanJobId,
          scanId: context.scanId,
          organizationId: context.organizationId,
          projectId: context.projectId,
          userId: context.userId,
          branch: context.branch,
          headCommitSha: context.headCommitSha,
          scanType: context.scanType ?? "full",
          jobType: "mcp_review",
        },
        {
          jobType: "mcp_review",
          // Run inline work in the same `after()` continuation — nested `after()` from
          // scheduleScanRun's default scheduler often never executes on serverless.
          scheduler: (fn) => {
            void fn();
          },
        }
      );
    });

  if (!input.githubRepo || !input.githubRepositoryId) {
    throw new ReviewNowError(
      "repository_disconnected",
      "This project's GitHub repository is not connected."
    );
  }

  const tokenResult = await resolveToken(admin, input.organizationId);
  if (!tokenResult) {
    throw new ReviewNowError(
      "repository_disconnected",
      "No organization member has a valid GitHub connection for this repository."
    );
  }

  const ref = parseGitHubRepository(input.githubRepo);

  let resolvedCommitSha: string;
  let resolvedBranch: string | null;
  try {
    const resolved = await resolveCommit(tokenResult.token, ref, {
      commitSha: input.requestedCommitSha,
      branch: input.requestedBranch,
    });
    resolvedCommitSha = resolved.sha;
    resolvedBranch = resolved.branch ?? input.requestedBranch ?? null;
  } catch (error) {
    if (error instanceof GitHubServiceError && error.code === "GITHUB_NOT_FOUND") {
      throw new ReviewNowError(
        input.requestedCommitSha ? "commit_not_found" : "repository_disconnected",
        input.requestedCommitSha
          ? `Commit "${input.requestedCommitSha}" was not found on this repository.`
          : "Could not resolve the repository's latest commit."
      );
    }
    if (error instanceof GitHubServiceError) {
      throw new ReviewNowError("internal_error", error.message);
    }
    throw new ReviewNowError("internal_error", "Could not resolve the commit to review.");
  }

  await recordLiveHeadCommit(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    githubRepositoryId: input.githubRepositoryId,
    commitSha: resolvedCommitSha,
    branch: resolvedBranch ?? "main",
  }).catch(() => undefined);

  await admin
    .from("projects")
    .update({
      github_last_commit_sha: resolvedCommitSha,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.projectId)
    .eq("organization_id", input.organizationId);

  await releaseActiveReviewForNewHead(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    targetCommitSha: resolvedCommitSha,
    targetBranch: resolvedBranch,
  });

  const [hasActiveReview, currentVerdict] = await Promise.all([
    (async () => {
      await recoverStaleActiveReviewsForProject(admin, input.projectId);
      return hasActiveRepositoryReview(admin, input.projectId);
    })(),
    getCurrentProductionVerdict(admin, input.projectId),
  ]);
  const activeReviewId = hasActiveReview ? await loadActiveScanId(admin, input.projectId) : null;

  const decision = decideReviewNowAction({
    hasActiveReview,
    activeReviewId,
    currentVerdictCommitSha: currentVerdict?.commitSha ?? null,
    requestedCommitSha: resolvedCommitSha,
  });

  if (decision.action === "reuse_active") {
    log("review_now_duplicate_processing", { projectId: input.projectId, reviewId: decision.reviewId });
    return { outcome: "processing", reviewId: decision.reviewId };
  }

  if (decision.action === "reuse_completed" && currentVerdict) {
    log("review_now_duplicate_completed", {
      projectId: input.projectId,
      commitSha: resolvedCommitSha,
    });
    return {
      outcome: "already_completed",
      reviewId: currentVerdict.scanId,
      verdictStatus: currentVerdict.status,
      score: currentVerdict.score,
      reviewedCommitSha: resolvedCommitSha,
    };
  }

  const { data: scan, error: insertError } = await admin
    .from("scans")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      repository_id: input.projectId,
      triggered_by_user_id: tokenResult.userId,
      trigger_type: "mcp",
      review_type: "manual",
      scan_type: "full",
      status: "queued",
      queued_at: new Date().toISOString(),
      progress: 0,
      progress_message: "Production Review requested from MCP",
      branch: resolvedBranch,
      commit_sha: resolvedCommitSha,
    })
    .select("id, created_at")
    .single();

  if (insertError) {
    // The partial unique index (one active full scan per repository) is the
    // concurrency authority — a race between two concurrent review_now
    // calls resolves here, not earlier.
    if (insertError.code === "23505") {
      const raceReviewId = await loadActiveScanId(admin, input.projectId);
      if (raceReviewId) {
        return { outcome: "processing", reviewId: raceReviewId };
      }
    }
    throw new ReviewNowError("review_creation_failed", "Could not create the Production Review.");
  }

  await admin.from("repository_scan_state").upsert(
    {
      repository_id: input.projectId,
      organization_id: input.organizationId,
      active_scan_id: scan.id,
    },
    { onConflict: "repository_id" }
  );

  log("review_now_queued", {
    projectId: input.projectId,
    reviewId: scan.id,
    commitSha: resolvedCommitSha,
  });

  const organizationId = input.organizationId;
  const projectId = input.projectId;
  const scanId: string = scan.id;
  const branchForRun = resolvedBranch ?? undefined;
  const userId = tokenResult.userId;

  scheduleBackground(async () => {
    await runScan({
      scanJobId: "",
      scanId,
      organizationId,
      projectId,
      userId,
      branch: branchForRun,
      scanType: "full",
      headCommitSha: resolvedCommitSha,
    }).catch((error) => {
      log("review_now_background_failed", {
        projectId,
        reviewId: scanId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  return {
    outcome: "queued",
    reviewId: scan.id,
    commitSha: resolvedCommitSha,
    branch: resolvedBranch,
    createdAt: scan.created_at as string,
  };
}
