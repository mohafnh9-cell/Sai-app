import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { runScanRedTeamPipeline } from "./run-scan-red-team";
import { buildScanJobPlatformMetadata } from "./build-scan-metadata";
import { persistScanJobPlatformMetadata, attachPlatformSummaryToScan } from "./persist-scan-platform";
import { assertScanContinues } from "@/server/review-cancel/review-abort";
import { runScanAttackSimulationPhase } from "@/server/attack-simulation/integration/run-scan-attack-simulation-phase";
import { persistSecurityIntelligence } from "@/server/ai-red-team/intelligence/persistence";
import { runSecurityEngines } from "@/server/security-engines/orchestrate";
import { persistEngineResults } from "@/server/security-engines/persistence";

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
  attackSimulation: Awaited<ReturnType<typeof runScanAttackSimulationPhase>> | null;
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

  await assertScanContinues(admin, input.scanId);

  const redTeam = await runScanRedTeamPipeline(input);
  await assertScanContinues(admin, input.scanId);

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
    return { redTeam, platformMetadata, attackSimulation: null };
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

  // Phase 34: expose the correlation/attack-chain intelligence that was just
  // computed (report.intelligence) as queryable rows, in addition to the
  // count + string summary already flattened into scan_jobs.metadata above.
  // Best-effort: a persistence failure here must not fail a scan that has
  // already completed successfully.
  if (redTeam.report.intelligence) {
    try {
      await assertScanContinues(admin, input.scanId);
      await persistSecurityIntelligence(admin, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        scanId: input.scanId,
        report: redTeam.report.intelligence,
      });
    } catch (error) {
      console.error({
        component: "platform-convergence",
        event: "security_intelligence_persist_failed",
        scanId: input.scanId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Phase 35: the multi-engine security layer (OpenGrep, Trivy, native
  // Crypto engine, OpenSSF Scorecard -- server/security-engines/*). ONE
  // execution path, callable from this same central scan pipeline stage
  // rather than hardcoded per-route (section 27). OpenGrep/Trivy self-report
  // SKIPPED with a clear reason when their binary env vars aren't configured
  // for this runtime (see Phase 35 final report: production Vercel
  // serverless cannot currently bundle either binary -- a worker-boundary
  // service is required and does not exist yet) -- never silently reported
  // as "0 findings." Best-effort/non-fatal, matching the Phase 34 pattern.
  try {
    await assertScanContinues(admin, input.scanId);
    const { data: project } = await admin
      .from("projects")
      .select("github_repo")
      .eq("id", input.projectId)
      .maybeSingle();
    const enginesOutput = await runSecurityEngines({
      scanId: input.scanId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      files: input.files,
      githubRepo: (project?.github_repo as string | null) ?? null,
    });
    await persistEngineResults(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      results: enginesOutput.results,
    });
  } catch (error) {
    console.error({
      component: "platform-convergence",
      event: "security_engines_phase_failed",
      scanId: input.scanId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  let attackSimulation: Awaited<ReturnType<typeof runScanAttackSimulationPhase>> | null = null;
  try {
    await assertScanContinues(admin, input.scanId);
    attackSimulation = await runScanAttackSimulationPhase(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      scanJobId: input.scanJobId,
      commitSha: input.commitSha,
      report: redTeam.report,
    });
  } catch (error) {
    console.error({
      component: "platform-convergence",
      event: "attack_simulation_phase_failed",
      scanId: input.scanId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return { redTeam, platformMetadata, attackSimulation };
}
