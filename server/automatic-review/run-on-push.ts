import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedPushDetection } from "@/brain/repository-sync";
import {
  shouldRunAutomaticReview,
  validateCommitForReview,
} from "@/brain/automatic-review";
import { GitHubServiceError } from "@/lib/github/repository-service";
import { markRepositorySyncError } from "@/server/repository-sync";
import { scheduleAutomationScan } from "@/server/jobs/schedule-scan";
import {
  buildCommitValidationInput,
  hasActiveRepositoryReview,
  hasCompletedAutomaticReviewForCommit,
} from "./queries";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "automatic-review", event, ...fields });
}

type ProjectRow = {
  id: string;
  organization_id: string;
  github_repo: string | null;
  github_repository_id: number | null;
};

export type AutomaticReviewRunResult =
  | {
      ok: true;
      action: "automatic_review_started";
      scanId: string;
      status: "queued" | "completed" | "failed";
      verdictUpdated: boolean;
      verdictError?: string;
    }
  | {
      ok: true;
      action: "automatic_review_skipped";
      reason: string;
    }
  | {
      ok: false;
      action: "automatic_review_failed";
      reason: string;
    };

export async function runAutomaticProductionReview(
  admin: SupabaseClient,
  input: {
    project: ProjectRow;
    detection: ParsedPushDetection;
    token: string;
    userId: string;
  }
): Promise<AutomaticReviewRunResult> {
  const repositoryConnected = Boolean(
    input.project.github_repo && input.project.github_repository_id
  );

  const commitValidation = validateCommitForReview(
    buildCommitValidationInput({
      detection: input.detection,
      githubRepositoryId: input.project.github_repository_id,
    })
  );

  const [hasCompletedReviewForCommit, hasActiveReview] = await Promise.all([
    hasCompletedAutomaticReviewForCommit(
      admin,
      input.project.id,
      input.detection.commitSha
    ),
    hasActiveRepositoryReview(admin, input.project.id),
  ]);

  const decision = shouldRunAutomaticReview({
    repositoryConnected,
    commitValidation,
    detection: input.detection,
    hasActiveReview,
    hasCompletedReviewForCommit,
  });

  if (!decision.shouldRun) {
    return {
      ok: true,
      action: "automatic_review_skipped",
      reason: decision.reason,
    };
  }

  const { data: scan, error: insertError } = await admin
    .from("scans")
    .insert({
      organization_id: input.project.organization_id,
      project_id: input.project.id,
      repository_id: input.project.id,
      triggered_by_user_id: input.userId,
      trigger_type: "webhook",
      review_type: "automatic",
      scan_type: "full",
      status: "queued",
      progress: 0,
      progress_message: "automaticQueued",
      branch: input.detection.branch,
      commit_sha: input.detection.commitSha,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        ok: true,
        action: "automatic_review_skipped",
        reason: "duplicate_review",
      };
    }
    return {
      ok: false,
      action: "automatic_review_failed",
      reason: insertError.message,
    };
  }

  await admin.from("repository_scan_state").upsert(
    {
      repository_id: input.project.id,
      organization_id: input.project.organization_id,
      active_scan_id: scan.id,
    },
    { onConflict: "repository_id" }
  );

  try {
    await scheduleAutomationScan(admin, {
      scanJobId: "",
      scanId: scan.id,
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      userId: input.userId,
      branch: input.detection.branch,
      scanType: "full",
      persistMode: "review_only",
      jobType: "automatic_review",
      finalize: { kind: "automatic_review" },
    });
  } catch (error) {
    if (
      error instanceof GitHubServiceError &&
      (error.code === "GITHUB_AUTH" || error.code === "GITHUB_FORBIDDEN")
    ) {
      await markRepositorySyncError(admin, {
        organizationId: input.project.organization_id,
        projectId: input.project.id,
        githubRepositoryId: input.project.github_repository_id,
        errorCode: "invalid_github_connection",
      });
    }

    log("automatic_review_failed", {
      projectId: input.project.id,
      commitSha: input.detection.commitSha,
      reason: error instanceof Error ? error.message : "review_failed",
    });

    return {
      ok: false,
      action: "automatic_review_failed",
      reason: error instanceof Error ? error.message : "review_failed",
    };
  }

  log("automatic_review_queued", {
    projectId: input.project.id,
    commitSha: input.detection.commitSha,
    scanId: scan.id,
  });

  return {
    ok: true,
    action: "automatic_review_started",
    scanId: scan.id,
    status: "queued",
    verdictUpdated: false,
  };
}
