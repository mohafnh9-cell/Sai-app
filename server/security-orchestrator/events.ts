import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrchestratorEventType } from "./types";

/**
 * Phase 36, section 23: reuses security_job_events (Phase 35.5, widened by
 * migration 064) rather than a second activity table. Scan-level events
 * (discovery, planning, correlation, verdict) have no single job_id -- that
 * column is now nullable specifically for this.
 */
export async function recordOrchestratorEvent(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    jobId?: string | null;
    eventType: OrchestratorEventType;
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  await admin.from("security_job_events").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    scan_id: input.scanId,
    job_id: input.jobId ?? null,
    event_type: input.eventType,
    detail: input.detail ?? {},
  });
}
