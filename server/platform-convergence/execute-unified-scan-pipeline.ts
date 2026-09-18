import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { runScanRedTeamPipeline } from "./run-scan-red-team";
import { buildScanJobPlatformMetadata } from "./build-scan-metadata";
import { persistScanJobPlatformMetadata, attachPlatformSummaryToScan } from "./persist-scan-platform";
import { assertScanContinues } from "@/server/review-cancel/review-abort";
import { runScanAttackSimulationPhase } from "@/server/attack-simulation/integration/run-scan-attack-simulation-phase";
import { persistSecurityIntelligence } from "@/server/ai-red-team/intelligence/persistence";
import { isSecurityWorkerEnabled } from "@/server/security-jobs/worker-config";
import { runSecurityOrchestration } from "@/server/security-orchestrator/orchestrate";

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

  // Phase 38: the ONE canonical orchestration path (Phase 36's
  // runSecurityOrchestration -- discovery, capability-driven planning,
  // execution-graph-backed SecurityJob creation, coverage, adaptive
  // investigation, AI reasoning, then Production Verdict, per Phase 37).
  // This REPLACES Phase 35's direct runSecurityEngines()/createSecurityJob
  // calls that previously lived here -- both review_now and
  // full_product_audit flow through this one pipeline stage (Phase 34's
  // established "one execution path" design), so wiring the orchestrator
  // in HERE gives both MCP tools real orchestrator coverage without
  // touching server/mcp/tools/*.ts at all, exactly the lowest-risk
  // integration point already proven safe across three prior phases.
  //
  // drainInline preserves the exact pre-existing fallback behavior: with
  // no Security Execution Worker deployed (isSecurityWorkerEnabled() ===
  // false, true in every environment today), engine jobs are claimed and
  // run inline through the SAME worker code a real deployed worker would
  // use -- OpenGrep/Trivy still self-report SKIPPED if their binaries
  // aren't present on this runtime (Vercel), never silently "0 findings."
  // Once a real worker is deployed and SECURITY_WORKER_ENABLED=true, this
  // flips to false and jobs are only created here, picked up
  // asynchronously by that worker -- unchanged from Phase 35.5's design.
  try {
    await assertScanContinues(admin, input.scanId);
    const { data: project } = await admin
      .from("projects")
      .select("github_repo")
      .eq("id", input.projectId)
      .maybeSingle();
    const githubRepo = (project?.github_repo as string | null) ?? null;

    await runSecurityOrchestration(admin, {
      scanId: input.scanId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      files: input.files,
      githubRepo,
      depth: "STANDARD",
      drainInline: !isSecurityWorkerEnabled(),
    });
  } catch (error) {
    console.error({
      component: "platform-convergence",
      event: "security_orchestration_phase_failed",
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
