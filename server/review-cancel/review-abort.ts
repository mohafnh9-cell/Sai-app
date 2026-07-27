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
  if (isScanCancellationTerminal(status) || !isActiveReviewScanStatus(status)) {
    throw new ScanCancelledError();
  }
}
