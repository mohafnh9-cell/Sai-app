import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { InlineScanJobRunner } from "@/server/security-scanner/scan-job-runner";
import { resolveOrganizationGitHubToken } from "@/server/github-automation/token-resolver";
import { alignScanWithRemoteHead } from "@/server/repository-sync/github-sync-snapshot";
import { beginReviewProcessing } from "./scan-execution/review-lifecycle";
import type { ScanRunPayload } from "./types";
import { ScanCancelledError } from "@/server/review-cancel/review-abort";

export function isScanJobsInfrastructureMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("scan_jobs") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("could not find the table"))
  );
}

async function loadGithubRepo(admin: SupabaseClient, projectId: string): Promise<string> {
  const { data, error } = await admin
    .from("projects")
    .select("github_repo")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data?.github_repo) {
    throw new Error("Project GitHub repository is not configured");
  }
  return data.github_repo as string;
}

/**
 * Runs a Production Review when `scan_jobs` is not deployed yet (pre-migration 020).
 * Same commit pinning and snapshot fetch as the job-based worker, without scan_jobs rows.
 */
export async function executeLegacyInlineScanRun(
  admin: SupabaseClient,
  payload: ScanRunPayload
): Promise<void> {
  const { data: scanBeforeRun } = await admin
    .from("scans")
    .select("status, commit_sha")
    .eq("id", payload.scanId)
    .maybeSingle();

  if (scanBeforeRun?.status === "queued") {
    await beginReviewProcessing(admin, {
      reviewId: payload.scanId,
      organizationId: payload.organizationId,
      projectId: payload.projectId,
      commitSha: (scanBeforeRun.commit_sha as string | null) ?? payload.headCommitSha ?? null,
      scheduler: "inline-legacy",
    });
  }

  const tokenResult = await resolveOrganizationGitHubToken(
    admin,
    payload.organizationId,
    payload.projectId
  );
  if (!tokenResult) {
    throw new Error("GITHUB_TOKEN_UNAVAILABLE");
  }

  const githubRepo = await loadGithubRepo(admin, payload.projectId);
  const aligned = await alignScanWithRemoteHead(admin, {
    organizationId: payload.organizationId,
    projectId: payload.projectId,
    scanId: payload.scanId,
    githubRepo,
    branch: payload.branch ?? null,
    expectedCommitSha:
      (scanBeforeRun?.commit_sha as string | null) ?? payload.headCommitSha ?? null,
  });

  const runner = new InlineScanJobRunner(admin);
  try {
    await runner.run({
      scanId: payload.scanId,
      repositoryId: payload.projectId,
      organizationId: payload.organizationId,
      githubRepo,
      branch: aligned?.branch ?? payload.branch,
      providerToken: tokenResult.token,
      scanType: payload.scanType,
      baseCommitSha: payload.baseCommitSha,
      headCommitSha: aligned?.commitSha ?? payload.headCommitSha,
      persistMode: payload.persistMode,
    });
  } catch (error) {
    if (error instanceof ScanCancelledError) return;
    throw error;
  }
}
