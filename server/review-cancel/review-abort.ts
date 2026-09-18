import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isActiveReviewScanStatus } from "@/brain/automatic-review/review-status";
import { isScanCancellationTerminal } from "@/lib/review/cancellation";

export class ScanCancelledError extends Error {
  readonly code = "USER_CANCELLED" as const;

  constructor(message = "Production review was cancelled") {
    super(message);
    this.name = "ScanCancelledError";
  }
}

export async function assertScanContinues(
  admin: SupabaseClient,
  scanId: string
): Promise<void> {
  const { data } = await admin.from("scans").select("status").eq("id", scanId).maybeSingle();
  const status = data?.status as string | undefined;
  if (!status) return;
  // "completed" is not a cancellation signal: the native scan phase
  // (scan-job-runner.ts) deliberately marks the scan "completed" -- exposing
  // score/findings to the user -- and then keeps running its own enrichment
  // phase (Security Orchestrator / red-team / Production Verdict) in the
  // same request. Treating "completed" as terminal-here made every call to
  // this function immediately after that marker throw ScanCancelledError,
  // silently skipping that entire enrichment phase for every review_now/
  // full_product_audit scan (found via Phase 41's real end-to-end test:
  // zero security_jobs/orchestrator events were ever created). Genuine
  // cancellation is still caught by isScanCancellationTerminal below, and a
  // scan that failed or was never started still correctly aborts here.
  if (status === "completed") return;
  if (isScanCancellationTerminal(status) || !isActiveReviewScanStatus(status)) {
    throw new ScanCancelledError();
  }
}
