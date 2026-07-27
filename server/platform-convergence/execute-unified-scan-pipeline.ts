import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { runScanRedTeamPipeline } from "./run-scan-red-team";
import { buildScanJobPlatformMetadata } from "./build-scan-metadata";
import { persistScanJobPlatformMetadata, attachPlatformSummaryToScan } from "./persist-scan-platform";

export type UnifiedScanPipelineInput = {
  scanId: string;
  scanJobId: string;
  organizationId: string;
  projectId: string;
  commitSha: string;
  files: Array<{ path: string; content: string }>;
};

export type UnifiedScanPipelineOutput = {
  redTeam: Awaited<ReturnType<typeof runScanRedTeamPipeline>>;
  platformMetadata: ReturnType<typeof buildScanJobPlatformMetadata> | null;
};

/**
 * Discovery → Security Director → RT9/RT10 → Intelligence → Decision
 * Persists Mission Control payload to scan_jobs.metadata.
 */
export async function executeUnifiedScanRedTeamPhase(
  admin: SupabaseClient,
  input: UnifiedScanPipelineInput
): Promise<UnifiedScanPipelineOutput> {
  console.info({
    component: "platform-convergence",
    event: "unified_red_team_phase_started",
    scanId: input.scanId,
    scanJobId: input.scanJobId,
    correlationId: input.scanId,
    executionId: input.scanJobId,
    organizationId: input.organizationId,
    projectId: input.projectId,
  });

  const redTeam = await runScanRedTeamPipeline(input);

  if (!redTeam.report) {
    const platformMetadata = {
      version: "1.0.0" as const,
      ids: redTeam.ids,
      pipelineStatus: redTeam.status,
      teamExecution: {},
      completedAt: new Date().toISOString(),
      errorMessage: redTeam.errorMessage ?? "Red team pipeline did not produce a report.",
    };
    await persistScanJobPlatformMetadata(admin, {
      scanJobId: input.scanJobId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      platform: platformMetadata,
    }).catch(() => undefined);
    return { redTeam, platformMetadata };
  }

  const platformMetadata = buildScanJobPlatformMetadata(redTeam, redTeam.report);
  await persistScanJobPlatformMetadata(admin, {
    scanJobId: input.scanJobId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    platform: platformMetadata,
  });
  await attachPlatformSummaryToScan(admin, { scanId: input.scanId, platform: platformMetadata });

  return { redTeam, platformMetadata };
}
