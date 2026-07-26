import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isActiveReviewScanStatus } from "@/brain/automatic-review/review-status";
import { emitOperationalEvent } from "@/server/observability/operational-events";
import {
  DEFAULT_QUEUE_STALE_MINUTES,
  getQueueStaleMinutes,
} from "@/server/observability/types";

const PROCESSING_SCAN_STATUSES = [
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
] as const;

export const REVIEW_STALE_FAILURE_CODE = "REVIEW_STALE_TIMED_OUT";

export type StaleReviewRecoveryResult = {
  recoveredReviewIds: string[];
  releasedActiveScanIds: string[];
};

function getQueuedStaleMs(): number {
  const minutes = getQueueStaleMinutes() || DEFAULT_QUEUE_STALE_MINUTES;
  return minutes * 60 * 1000;
}

function getProcessingStaleMs(): number {
  const raw = Number(process.env.SCAN_REVIEW_PROCESSING_STALE_MINUTES ?? 20);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 20;
  return minutes * 60 * 1000;
}

function isProcessingScanStatus(status: string): boolean {
  return (PROCESSING_SCAN_STATUSES as readonly string[]).includes(status);
}

export function isStaleActiveReviewScan(
  scan: {
    status: string;
    created_at: string;
    updated_at: string;
    started_at?: string | null;
    queued_at?: string | null;
  },
  nowMs = Date.now()
): boolean {
  if (!isActiveReviewScanStatus(scan.status)) return false;
  if (scan.status === "queued") {
    const anchor = scan.queued_at ?? scan.created_at;
    return nowMs - Date.parse(anchor) >= getQueuedStaleMs();
  }
  if (isProcessingScanStatus(scan.status)) {
    const anchor = scan.started_at ?? scan.updated_at ?? scan.created_at;
    return nowMs - Date.parse(anchor) >= getProcessingStaleMs();
  }
  return false;
}

async function releaseActiveScanLock(
  admin: SupabaseClient,
  projectId: string,
  scanId: string
): Promise<boolean> {
  const { data } = await admin
    .from("repository_scan_state")
    .update({ active_scan_id: null })
    .eq("repository_id", projectId)
    .eq("active_scan_id", scanId)
    .select("repository_id")
    .maybeSingle();
  return Boolean(data);
}

async function markReviewStaleTimedOut(
  admin: SupabaseClient,
  scan: { id: string; status: string; organization_id?: string | null; project_id?: string | null },
  reason: "queued_stale" | "processing_stale"
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("scans")
    .update({
      status: "failed",
      failed_at: now,
      error_code: REVIEW_STALE_FAILURE_CODE,
      error_message:
        reason === "queued_stale"
          ? "Review remained queued beyond the allowed window"
          : "Review remained in progress beyond the allowed window",
      progress_message: "Review timed out and was recovered",
    })
    .eq("id", scan.id)
    .in("status", ["queued", ...PROCESSING_SCAN_STATUSES])
    .select("id, organization_id, project_id, repository_id")
    .maybeSingle();

  if (!data) return false;

  await admin
    .from("scan_jobs")
    .update({
      status: "failed",
      failure_code: REVIEW_STALE_FAILURE_CODE,
      failure_message:
        reason === "queued_stale"
          ? "Scan job never started before review recovery"
          : "Scan job lost heartbeat before review recovery",
      failed_at: now,
      updated_at: now,
      locked_at: null,
      locked_by: null,
    })
    .eq("scan_id", scan.id)
    .in("status", ["queued", "running"]);

  await emitOperationalEvent(admin, {
    eventType: "job_timed_out",
    scanId: scan.id,
    projectId: (data.project_id as string | null) ?? (data.repository_id as string | null) ?? undefined,
    organizationId: (data.organization_id as string | null) ?? undefined,
    failureCode: REVIEW_STALE_FAILURE_CODE,
    metadata: { recoveryReason: reason },
  });

  return true;
}

export async function recoverStaleActiveReviewsForProject(
  admin: SupabaseClient,
  projectId: string,
  nowMs = Date.now()
): Promise<StaleReviewRecoveryResult> {
  const { data: activeScans } = await admin
    .from("scans")
    .select("id, status, created_at, updated_at, started_at, queued_at, organization_id, project_id, repository_id")
    .eq("repository_id", projectId)
    .in("status", ["queued", ...PROCESSING_SCAN_STATUSES])
    .order("created_at", { ascending: false });

  const recoveredReviewIds: string[] = [];
  const releasedActiveScanIds: string[] = [];

  for (const scan of activeScans ?? []) {
    if (!isStaleActiveReviewScan(scan as never, nowMs)) continue;
    const reason = scan.status === "queued" ? "queued_stale" : "processing_stale";
    const recovered = await markReviewStaleTimedOut(admin, scan as never, reason);
    if (!recovered) continue;
    recoveredReviewIds.push(scan.id as string);
    const released = await releaseActiveScanLock(admin, projectId, scan.id as string);
    if (released) releasedActiveScanIds.push(scan.id as string);
  }

  return { recoveredReviewIds, releasedActiveScanIds };
}

export async function recoverReviewById(
  admin: SupabaseClient,
  reviewId: string,
  options?: { force?: boolean; nowMs?: number }
): Promise<{ recovered: boolean; reason?: string }> {
  const { data: scan } = await admin
    .from("scans")
    .select("id, status, created_at, updated_at, started_at, repository_id, project_id")
    .eq("id", reviewId)
    .maybeSingle();

  if (!scan) return { recovered: false, reason: "not_found" };
  if (!isActiveReviewScanStatus(scan.status as string)) {
    return { recovered: false, reason: "not_active" };
  }

  const nowMs = options?.nowMs ?? Date.now();
  if (!options?.force && !isStaleActiveReviewScan(scan as never, nowMs)) {
    return { recovered: false, reason: "not_stale" };
  }

  const reason = scan.status === "queued" ? "queued_stale" : "processing_stale";
  const recovered = await markReviewStaleTimedOut(admin, scan as never, reason);
  if (!recovered) return { recovered: false, reason: "already_terminal" };

  const projectId = (scan.repository_id as string | null) ?? (scan.project_id as string | null);
  if (projectId) {
    await releaseActiveScanLock(admin, projectId, reviewId);
  }

  return { recovered: true, reason };
}

export async function expireStaleActiveReviewsForRepository(
  admin: SupabaseClient,
  repositoryId: string
): Promise<StaleReviewRecoveryResult> {
  return recoverStaleActiveReviewsForProject(admin, repositoryId);
}
