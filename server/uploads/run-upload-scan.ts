import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { InlineScanJobRunner } from "@/server/security-scanner/scan-job-runner";
import { createScanJob, markScanJobCompleted, markScanJobFailed, markScanJobRunning } from "@/server/jobs/scan-job-store";
import { ensureProductionVerdictForCompletedScan } from "@/server/production-verdict/ensure-verdict-for-scan";
import type { RepositorySnapshot } from "@/lib/github/repository-service";

export class UploadScanError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "UploadScanError";
  }
}

/**
 * Runs an already-validated, already-extracted upload through the exact
 * same scan pipeline a GitHub scan uses (InlineScanJobRunner ->
 * scanRepository -> generateAndPersistProductionVerdict). This is the
 * ingestion-method boundary Phase 10 is about: everything past this point
 * is identical to a GitHub-sourced scan.
 *
 * Deliberately does NOT go through scheduleScanRun/Inngest: uploads are
 * bounded (the same GITHUB_SCAN_LIMITS-derived caps apply) and fast enough
 * to run synchronously inside the request, and their file contents would be
 * a poor fit for Inngest's event payload / scan_jobs.metadata (both meant
 * for small, durable, serializable data, not full source trees). A real
 * scan_jobs row is still created directly so Scanner Results' execution
 * trace and the platform-convergence (AI red-team) phase both work exactly
 * as they do for a GitHub scan -- only the *scheduling* layer is skipped,
 * not the pipeline.
 */
export async function runUploadScan(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    userId: string;
    snapshot: RepositorySnapshot;
    /** "upload" (ZIP) or "local" (browser directory picker, Phase 11). Defaults to "upload". */
    source?: "upload" | "local";
  }
): Promise<{ scanId: string }> {
  const { data: scan, error: insertError } = await admin
    .from("scans")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      repository_id: input.projectId,
      triggered_by_user_id: input.userId,
      trigger_type: "manual",
      review_type: "manual",
      scan_type: "full",
      source: input.source ?? "upload",
      status: "queued",
      queued_at: new Date().toISOString(),
      progress: 0,
      progress_message: "uploadQueued",
      branch: input.snapshot.defaultBranch,
      commit_sha: input.snapshot.commitSha,
    })
    .select("id")
    .single();

  if (insertError || !scan) {
    throw new UploadScanError("scan_creation_failed", "Could not create the scan record.");
  }

  const scanId = scan.id as string;

  await admin.from("repository_scan_state").upsert(
    { repository_id: input.projectId, organization_id: input.organizationId, active_scan_id: scanId },
    { onConflict: "repository_id" }
  );

  const { job } = await createScanJob(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId,
    jobType: "manual_scan",
    metadata: { scanType: "full", source: "upload", userId: input.userId },
  });

  const scanJobId = job?.id;
  if (scanJobId) {
    await markScanJobRunning(admin, scanJobId, { lockedBy: "upload-inline" });
  }

  const runner = new InlineScanJobRunner(admin);

  try {
    await runner.run({
      scanId,
      scanJobId,
      repositoryId: input.projectId,
      organizationId: input.organizationId,
      scanType: "full",
      persistMode: "full",
      prefetchedSnapshot: input.snapshot,
    });
  } catch (error) {
    if (scanJobId) {
      await markScanJobFailed(admin, scanJobId, {
        failureCode: "UPLOAD_SCAN_FAILED",
        failureMessage: error instanceof Error ? error.message : "Upload scan failed",
      }).catch(() => undefined);
    }
    throw error;
  }

  if (scanJobId) {
    await markScanJobCompleted(admin, scanJobId).catch(() => undefined);
  }

  // The runner's own internal verdict-generation step is guarded by an
  // active-status check that (by design, per its cancellation semantics)
  // treats the scan's own just-written "completed" status as no longer
  // active and skips generation -- GitHub scans rely on run-scan-job.ts
  // calling this exact idempotent safety net afterward for that reason.
  // Upload bypasses that outer orchestrator (see the module docblock above),
  // so it must call the same safety net directly, or a completed upload
  // scan would silently end up with no Production Verdict.
  await ensureProductionVerdictForCompletedScan(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId,
    scanJobId,
  });

  return { scanId };
}
