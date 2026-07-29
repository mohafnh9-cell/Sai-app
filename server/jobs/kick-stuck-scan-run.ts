import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { executeScanRunJob } from "./run-scan-job";
import type { ScanRunPayload } from "./types";
import { getScanJob } from "./scan-job-store";

const KICK_AFTER_MS = 15_000;

/**
 * Recovers scans stuck in `queued` when the async worker never started (e.g. Inngest-only deploy).
 * Safe to call on every poll — execution is idempotent once the job is running.
 */
export async function maybeKickStuckQueuedScanRun(
  admin: SupabaseClient,
  input: {
    scan: Record<string, unknown>;
    scanJob: { id: string; status: string; created_at?: string | null } | null;
  }
): Promise<boolean> {
  const scanStatus = String(input.scan.status ?? "").toLowerCase();
  if (scanStatus !== "queued") return false;
  if (!input.scanJob || input.scanJob.status !== "queued") return false;

  const anchor =
    (input.scanJob.created_at as string | null) ??
    (input.scan.created_at as string | null) ??
    null;
  if (!anchor) return false;
  if (Date.now() - new Date(anchor).getTime() < KICK_AFTER_MS) return false;

  const job = await getScanJob(admin, input.scanJob.id);
  if (!job || job.status !== "queued") return false;

  const meta = (job.metadata as Record<string, unknown> | null) ?? {};
  const scanId = input.scan.id as string;
  const payload: ScanRunPayload = {
    scanJobId: job.id,
    scanId,
    organizationId: (input.scan.organization_id as string) ?? (job.organization_id as string),
    projectId: (input.scan.project_id as string) ?? (job.project_id as string),
    userId: (input.scan.triggered_by_user_id as string) ?? "recovery-kick",
    jobType: (job.job_type as ScanRunPayload["jobType"]) ?? "manual_scan",
    scanType: (meta.scanType as "full" | "incremental") ?? "full",
    branch: (meta.branch as string | undefined) ?? (input.scan.branch as string | undefined),
    headCommitSha:
      (meta.headCommitSha as string | undefined) ??
      (input.scan.commit_sha as string | undefined),
  };

  console.info({
    component: "kick-stuck-scan-run",
    event: "inline_kick_started",
    scanId,
    scanJobId: job.id,
  });

  await executeScanRunJob(admin, payload, { lockedBy: "stuck-scan-kick" });
  return true;
}
