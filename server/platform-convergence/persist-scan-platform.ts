import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanJobPlatformMetadata } from "./types";
import { flattenPlatformMetadataForScanJob } from "./build-scan-metadata";
import { emitOperationalEvent } from "@/server/observability/operational-events";

export async function persistScanJobPlatformMetadata(
  admin: SupabaseClient,
  input: {
    scanJobId: string;
    organizationId: string;
    projectId: string;
    scanId: string;
    platform: ScanJobPlatformMetadata;
  }
): Promise<void> {
  const { data: job, error: readError } = await admin
    .from("scan_jobs")
    .select("metadata")
    .eq("id", input.scanJobId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Could not read scan job metadata: ${readError.message}`);
  }

  const prior = (job?.metadata ?? {}) as Record<string, unknown>;
  const flattened = flattenPlatformMetadataForScanJob(input.platform);
  const metadata = {
    ...prior,
    ...flattened,
    platformConvergence: input.platform,
  };

  const { error: updateError } = await admin
    .from("scan_jobs")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", input.scanJobId);

  if (updateError) {
    await emitOperationalEvent(admin, {
      eventType: "job_failed",
      scanId: input.scanId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      scanJobId: input.scanJobId,
      failureCode: "PLATFORM_METADATA_PERSIST_FAILED",
      metadata: { correlationId: input.platform.ids.correlationId },
    }).catch(() => undefined);
    throw new Error(`Could not persist platform metadata: ${updateError.message}`);
  }

  await emitOperationalEvent(admin, {
    eventType: "job_completed",
    scanId: input.scanId,
    projectId: input.projectId,
    organizationId: input.organizationId,
    scanJobId: input.scanJobId,
    metadata: {
      platformConvergence: true,
      pipelineStatus: input.platform.pipelineStatus,
      correlationId: input.platform.ids.correlationId,
    },
  });
}

/** Merge platform execution summary onto scan row metrics (read-only analytics). */
export async function attachPlatformSummaryToScan(
  admin: SupabaseClient,
  input: { scanId: string; platform: ScanJobPlatformMetadata }
): Promise<void> {
  const { data: scan } = await admin.from("scans").select("metrics").eq("id", input.scanId).maybeSingle();
  const metrics = (scan?.metrics as Record<string, unknown> | null) ?? {};
  await admin
    .from("scans")
    .update({
      metrics: {
        ...metrics,
        platformExecution: {
          correlationId: input.platform.ids.correlationId,
          executionId: input.platform.ids.executionId,
          decisionId: input.platform.ids.decisionId,
          pipelineStatus: input.platform.pipelineStatus,
          durationMs: input.platform.completedAt,
        },
      },
    })
    .eq("id", input.scanId);
}
