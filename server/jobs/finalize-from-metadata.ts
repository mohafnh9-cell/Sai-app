import type { ScanRunPayload } from "./types";

const FINALIZE_KINDS = new Set(["webhook_automation", "webhook_pr", "automatic_review", "incremental_record"]);

/**
 * The Inngest `scan/run` event schema deliberately carries no `finalize`
 * block (it strips unknown keys), so a job executed through Inngest would
 * silently skip its post-scan finalization (GitHub status/check run, PR
 * record, alerts). The block is persisted on the job row when the job is
 * scheduled; this restores it, and only for a well-formed known kind.
 */
export function withFinalizeFromJobMetadata(
  payload: ScanRunPayload,
  jobMetadata: Record<string, unknown> | null | undefined
): ScanRunPayload {
  if (payload.finalize) return payload;
  const stored = jobMetadata?.finalize;
  if (!stored || typeof stored !== "object") return payload;
  const kind = (stored as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !FINALIZE_KINDS.has(kind)) return payload;
  return { ...payload, finalize: stored as ScanRunPayload["finalize"] };
}
