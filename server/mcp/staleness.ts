import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWebhookCallbackUrl } from "@/lib/github/webhook-service";

export type FreshnessStatus = "current" | "stale" | "unknown";

export type StalenessInfo = {
  latestDetectedCommitSha: string | null;
  /** true whenever freshnessStatus !== "current" — kept for backward compatibility. */
  stale: boolean;
  reviewInProgress: boolean;
  /** true when the most recent automatic (webhook-triggered) review failed. */
  reviewFailed: boolean;
  freshnessStatus: FreshnessStatus;
};

type SyncStatusRow = {
  commit_sha: string | null;
  connection_status: string | null;
  last_error: string | null;
};

type WebhookRow = {
  active: boolean | null;
  callback_url: string | null;
  last_delivery_at: string | null;
};

type ScanStateRow = {
  active_scan_id: string | null;
};

type LatestAutomaticScanRow = {
  status: string;
  commit_sha: string | null;
};

/**
 * Whether we have positive evidence that push detection for this project is
 * actually working — i.e. that if a newer commit existed, we would already
 * know about it. This is what separates "current" (verified) from "unknown"
 * (no reliable signal) when `repository_sync_status` has never recorded a
 * push.
 *
 * The registered webhook's callback URL is compared against the URL the
 * running deployment currently expects. A mismatch (e.g. the webhook was
 * registered against `http://localhost:3000/...` while production expects
 * `https://<app>.vercel.app/...`) means GitHub can never actually reach this
 * endpoint — the exact failure mode that caused a real Production Verdict to
 * be reported as fresh while multiple newer commits went undetected.
 */
function isPushDetectionTrustworthy(input: {
  hasGithubRepo: boolean;
  webhook: WebhookRow | null;
  syncStatus: SyncStatusRow | null;
}): boolean {
  if (!input.hasGithubRepo) return true; // nothing to detect drift against

  if (!input.webhook || input.webhook.active !== true) return false;

  // A webhook that has never once delivered is unproven — it may look
  // "active" while pointing at an address GitHub can never reach (the exact
  // failure mode audited in this fix: a hook registered against
  // http://localhost:3000 stays "active" forever with zero deliveries).
  if (!input.webhook.last_delivery_at) return false;

  const expectedCallbackUrl = resolveWebhookCallbackUrl();
  if (
    expectedCallbackUrl &&
    input.webhook.callback_url &&
    input.webhook.callback_url.replace(/\/$/, "") !== expectedCallbackUrl.replace(/\/$/, "")
  ) {
    return false;
  }

  if (!input.syncStatus || input.syncStatus.connection_status !== "connected") return false;
  if (input.syncStatus.last_error) return false;

  return true;
}

/**
 * ADR-001: this only retrieves and compares already-persisted signals (the
 * reviewed verdict's commit vs. the repository's independently detected
 * latest commit). It never recalculates score, status, or blockers.
 *
 * `latestDetectedCommitSha` is sourced from `repository_sync_status` (falling
 * back to the latest automatic-review scan's commit), both of which are
 * written independently of whether a scan ever runs or succeeds — so
 * freshness detection never depends on a scan succeeding. When neither
 * source has ever recorded anything, `freshnessStatus` degrades to
 * "unknown" unless `isPushDetectionTrustworthy` can prove push detection is
 * actually wired up correctly for this repository; it is never assumed to
 * be "current" by default.
 */
export async function getStalenessInfo(
  admin: SupabaseClient,
  projectId: string,
  reviewedCommitSha: string | null
): Promise<StalenessInfo> {
  const [{ data: project }, { data: syncStatus }, { data: webhook }, { data: scanState }, { data: automaticScans }] =
    await Promise.all([
      admin.from("projects").select("github_repo, github_default_branch").eq("id", projectId).maybeSingle(),
      admin
        .from("repository_sync_status")
        .select("commit_sha, connection_status, last_error")
        .eq("project_id", projectId)
        .maybeSingle(),
      admin
        .from("github_webhooks")
        .select("active, callback_url, last_delivery_at")
        .eq("project_id", projectId)
        .maybeSingle(),
      admin
        .from("repository_scan_state")
        .select("active_scan_id")
        .eq("repository_id", projectId)
        .maybeSingle(),
      admin
        .from("scans")
        .select("status, commit_sha, branch")
        .eq("repository_id", projectId)
        .eq("review_type", "automatic")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
  const defaultBranch =
    (project as { github_default_branch?: string | null } | null)?.github_default_branch ?? null;
  const onDefaultBranch = (branch: string | null | undefined) =>
    !defaultBranch || !branch || branch === defaultBranch;

  const sync = (syncStatus ?? null) as SyncStatusRow | null;
  const hook = (webhook ?? null) as WebhookRow | null;
  const state = (scanState ?? null) as ScanStateRow | null;
  const latestAutomatic = ((automaticScans ?? []) as Array<LatestAutomaticScanRow & { branch?: string | null }>).find(
    (row) => onDefaultBranch(row.branch)
  ) ?? null;

  // An active review of another branch is not a review "in progress" for the
  // default branch's decision.
  let reviewInProgress = false;
  if (state?.active_scan_id) {
    const { data: activeScan } = await admin
      .from("scans")
      .select("branch")
      .eq("id", state.active_scan_id)
      .maybeSingle();
    reviewInProgress = onDefaultBranch((activeScan as { branch?: string | null } | null)?.branch);
  }
  const reviewFailed = latestAutomatic?.status === "failed";

  // Deliberately excludes repository_scan_state.last_commit_sha: that column
  // is a byproduct of the *last scan that happened to run* (manual or
  // automatic), not an independent detection signal — using it here would
  // silently reintroduce the original bug for any project whose only scans
  // are manual, since it always mirrors whatever was last reviewed.
  const latestDetectedCommitSha = sync?.commit_sha ?? latestAutomatic?.commit_sha ?? null;

  let freshnessStatus: FreshnessStatus;
  if (!reviewedCommitSha) {
    freshnessStatus = "unknown";
  } else if (latestDetectedCommitSha) {
    freshnessStatus = latestDetectedCommitSha === reviewedCommitSha ? "current" : "stale";
  } else {
    const trustworthy = isPushDetectionTrustworthy({
      hasGithubRepo: Boolean((project as { github_repo: string | null } | null)?.github_repo),
      webhook: hook,
      syncStatus: sync,
    });
    // Never invent freshness: if we cannot prove push detection actually
    // works for this repository, we cannot claim the verdict is current.
    freshnessStatus = trustworthy ? "current" : "unknown";
  }

  // A failed automatic review is positive evidence of a newer, unreviewed
  // commit — that always counts as stale, never as merely "unknown".
  if (reviewFailed && latestAutomatic?.commit_sha && latestAutomatic.commit_sha !== reviewedCommitSha) {
    freshnessStatus = "stale";
  }

  return {
    latestDetectedCommitSha,
    stale: freshnessStatus !== "current",
    reviewInProgress,
    reviewFailed,
    freshnessStatus,
  };
}
