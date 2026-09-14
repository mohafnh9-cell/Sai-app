import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildApplicationSurface } from "./application-surface";
import { buildSecurityPlan } from "./planner";
import { validateSecurityPlan } from "./ai-plan-validation";
import { buildExecutionGraph } from "./execution-graph";
import { buildCoverageReport } from "./coverage";
import { loadNativeEngineResult } from "./native-coverage";
import { runAdaptiveInvestigation } from "./adaptive-investigation";
import { runSecurityReasoning } from "./security-reasoner";
import { recordOrchestratorEvent } from "./events";
import { createSecurityJob, claimNextSecurityJob } from "@/server/security-jobs/service";
import { runClaimedSecurityJob } from "@/server/security-jobs/worker-run-job";
import { listExternalAndNativeAdjacentEngines } from "@/server/security-engines/registry";
import type { EngineId, EngineResult } from "@/server/security-engines/types";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import type {
  CoverageReport,
  InvestigationDecision,
  PerformanceTelemetry,
  ScanDepth,
  SecurityPlan,
} from "./types";

/**
 * Phase 36, section 4/33: the orchestrator's job is DISCOVER -> PLAN ->
 * schedule via SecurityJobService -> collect -> correlate -> investigate ->
 * verdict. It never spawns an engine subprocess itself -- every engine
 * execution goes through createSecurityJob()/the worker's own
 * runClaimedSecurityJob(), exactly the Phase 35.5 code, never duplicated.
 *
 * `drainInline`: when true, this function also claims and runs the jobs it
 * just created using the SAME worker code a real deployed worker process
 * would use (server/security-jobs/worker-run-job.ts) -- this is the honest
 * fallback for "no worker is deployed yet" (Phase 35.5's real state) and is
 * how the real end-to-end test in this phase proves the full chain without
 * a separately-running process. In production, once a worker IS deployed,
 * this should stay false: jobs are created and the function returns
 * immediately with QUEUED status, exactly like any other async job queue.
 */
export type OrchestrationInput = {
  scanId: string;
  organizationId: string;
  projectId: string;
  files: Array<{ path: string; content: string }>;
  githubRepo: string | null;
  depth?: ScanDepth;
  drainInline?: boolean;
};

export type SecurityOrchestrationResult = {
  plan: SecurityPlan;
  coverage: CoverageReport;
  investigations: InvestigationDecision[];
  aiReasoning: Awaited<ReturnType<typeof runSecurityReasoning>>;
  verdictStatus: string | null;
  verdictScore: number | null;
  verdictNote: string;
  telemetry: PerformanceTelemetry;
  jobsCreated: number;
};

export async function runSecurityOrchestration(
  admin: SupabaseClient,
  input: OrchestrationInput
): Promise<SecurityOrchestrationResult> {
  const totalStart = Date.now();
  let engineFailures = 0;
  let timeouts = 0;

  // --- DISCOVERY -----------------------------------------------------
  const discoveryStart = Date.now();
  await recordOrchestratorEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    eventType: "DISCOVERY_STARTED",
  });
  const applicationSurface = buildApplicationSurface({ files: input.files, githubRepo: input.githubRepo });
  const discoveryDurationMs = Date.now() - discoveryStart;
  await recordOrchestratorEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    eventType: "DISCOVERY_COMPLETED",
    detail: { languages: applicationSurface.stack.languages, frameworks: applicationSurface.stack.frameworks },
  });

  // --- PLANNING --------------------------------------------------------
  const planningStart = Date.now();
  const plan = buildSecurityPlan({
    scanId: input.scanId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    applicationSurface,
    files: input.files,
    depth: input.depth,
  });
  // Deterministic plans pass this trivially -- the same gate an
  // AI-influenced plan would have to pass (section 18). Cheap, always run.
  validateSecurityPlan(plan, { organizationId: input.organizationId, projectId: input.projectId, scanId: input.scanId });
  const planningDurationMs = Date.now() - planningStart;
  await recordOrchestratorEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    eventType: "PLAN_CREATED",
    detail: { planId: plan.planId, depth: plan.depth, selectedEngines: plan.selectedEngines },
  });

  const graph = buildExecutionGraph(plan);
  const staticStage = graph.stages.find((s) => s.id === "STATIC_ANALYSIS");
  const engineIds = (staticStage?.engines ?? []).filter((id): id is Exclude<EngineId, "native"> => id !== "native");

  // --- SECURITY JOBS (section 10/11/33) --------------------------------
  const queueStart = Date.now();
  const engineVersionById = new Map(listExternalAndNativeAdjacentEngines().map((e) => [e.id, e.version]));
  let jobsCreated = 0;
  const jobIds: string[] = [];
  for (const engineId of engineIds) {
    const job = await createSecurityJob(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      engine: engineId,
      engineVersion: engineVersionById.get(engineId) ?? "unknown",
      capabilities: plan.decisions.find((d) => d.engine === engineId)?.capabilities ?? [],
    });
    jobIds.push(job.id);
    jobsCreated += 1;
    await recordOrchestratorEvent(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      jobId: job.id,
      eventType: "JOB_QUEUED",
      detail: { engine: engineId },
    });
  }
  const queueLatencyMs = Date.now() - queueStart;

  // --- COLLECT RESULTS ---------------------------------------------------
  const engineStart = Date.now();
  const results = new Map<EngineId, EngineResult>();
  if (input.drainInline) {
    // Reuses the exact worker code (server/security-jobs/worker-run-job.ts)
    // -- not a second execution path. See the doc comment above.
    //
    // IMPORTANT (found during the adversarial audit, section 37): the
    // shared claim_next_security_job() claims the oldest QUEUED job across
    // the ENTIRE queue, not just this scan's -- in a real deployment with
    // other tenants' jobs also queued, a naive "claim, check if it's ours,
    // skip if not" loop would claim a foreign job (atomically flipping it
    // to RUNNING) and then abandon it there forever, since "skip" never
    // released or completed it. A claimer must always finish what it
    // claims. This loop therefore runs EVERY job it claims to completion
    // (whether or not it's one of this call's own jobIds) and only stops
    // once all of ITS OWN jobs are accounted for -- never leaves a foreign
    // job stuck in RUNNING. drainInline must still never be used against a
    // real shared production queue (see the doc comment above) -- this is
    // defense-in-depth for the case where it is anyway.
    const ownJobsPending = new Set(jobIds);
    while (ownJobsPending.size > 0) {
      const claimed = await claimNextSecurityJob(admin, "orchestrator-inline-drain");
      if (!claimed) break; // queue is empty -- nothing left to claim, including for other tenants
      const isOwnJob = ownJobsPending.has(claimed.id);
      if (isOwnJob) {
        await recordOrchestratorEvent(admin, {
          organizationId: input.organizationId,
          projectId: input.projectId,
          scanId: input.scanId,
          jobId: claimed.id,
          eventType: "JOB_STARTED",
          detail: { engine: claimed.engine },
        });
      }
      // input.files is this scan's commit content, already resident in this
      // process (used above for discovery/planning) -- reuse it instead of
      // letting each of THIS call's own engine jobs independently
      // re-download and re-extract the same GitHub tarball (Performance
      // Audit finding #3). A claimed job that belongs to a different
      // scan/tenant (see the comment above -- claimNextSecurityJob claims
      // globally, not scoped to this scan) must NEVER receive this scan's
      // files/repo: that would run a foreign job's engine against the
      // wrong repository entirely. Only pass the pre-fetched snapshot for
      // this call's own jobs; every foreign job keeps fetching for itself,
      // scoped to its own scanId/projectId, exactly as before this change.
      const runResult = await runClaimedSecurityJob(
        admin,
        claimed,
        isOwnJob ? { preFetchedFiles: input.files, githubRepo: input.githubRepo } : undefined
      );
      if (isOwnJob) {
        ownJobsPending.delete(claimed.id);
        if (runResult.engineResult) results.set(claimed.engine, runResult.engineResult);
        if (runResult.status === "FAILED") engineFailures += 1;
        if (runResult.status === "TIMED_OUT") timeouts += 1;
        await recordOrchestratorEvent(admin, {
          organizationId: input.organizationId,
          projectId: input.projectId,
          scanId: input.scanId,
          jobId: claimed.id,
          eventType: runResult.status === "COMPLETED" ? "JOB_COMPLETED" : "JOB_FAILED",
          detail: { status: runResult.status },
        });
      }
    }
  }
  const engineDurationMs = Date.now() - engineStart;

  // --- NATIVE COVERAGE (Phase 38, section 10) ---------------------------
  // native has no SecurityJob -- it already ran on its own existing
  // pipeline stage, strictly before this orchestrator, for the same
  // scanId (see native-coverage.ts doc comment). Read that one source of
  // truth in rather than leaving native permanently UNAVAILABLE in
  // coverage/allFindings below, and never execute it a second time here.
  const nativeDecision = plan.decisions.find((d) => d.engine === "native");
  if (nativeDecision?.selected) {
    const nativeResult = await loadNativeEngineResult(admin, {
      scanId: input.scanId,
      projectId: input.projectId,
      organizationId: input.organizationId,
    });
    results.set("native", nativeResult);
    if (nativeResult.status === "FAILED") engineFailures += 1;
  }

  // --- CORRELATION / COVERAGE (section 21) -----------------------------
  const correlationStart = Date.now();
  await recordOrchestratorEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    eventType: "CORRELATION_STARTED",
  });
  const coverage = buildCoverageReport(plan, results);
  const correlationDurationMs = Date.now() - correlationStart;
  await recordOrchestratorEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    eventType: "CORRELATION_COMPLETED",
    detail: { planned: coverage.planned, applicable: coverage.applicable, withFindings: coverage.withFindings },
  });

  // --- ATTACK CHAINS (section 20: reuse, never rebuild) -----------------
  const attackChainStart = Date.now();
  const { data: chainRows } = await admin
    .from("attack_chains")
    .select("id")
    .eq("scan_id", input.scanId)
    .eq("status", "CONFIRMED");
  if ((chainRows ?? []).length > 0) {
    await recordOrchestratorEvent(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      eventType: "ATTACK_CHAIN_DETECTED",
      detail: { confirmedChainCount: (chainRows ?? []).length },
    });
  }
  const attackChainDurationMs = Date.now() - attackChainStart;

  // --- ADAPTIVE INVESTIGATION (section 13/14) ---------------------------
  const investigationStart = Date.now();
  await recordOrchestratorEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    eventType: "INVESTIGATION_STARTED",
  });
  const allFindings = [...results.values()].flatMap((r) => r.findings);
  const investigations = await runAdaptiveInvestigation(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    findings: allFindings,
  });
  await recordOrchestratorEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    eventType: "INVESTIGATION_COMPLETED",
    detail: { triggered: investigations.length, escalated: investigations.filter((i) => i.escalated).length },
  });

  // --- AI REASONING (Phase 37 workstream E) -----------------------------
  // Distinct from Phase 34's server/ai-reasoning/run-scan-reasoning.ts
  // (which produces per-finding taint-flow narratives for the native
  // scanner's own findings, invoked from generateAndPersistProductionVerdict).
  // This is the orchestrator-level reasoner: it looks across ALL engines'
  // findings + attack chains + coverage for this scan, not just one
  // engine's output. It is additive and never blocks the pipeline -- any
  // outcome other than COMPLETED still lets PRODUCTION_VERDICT run.
  const aiReasoningStart = Date.now();
  await recordOrchestratorEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    eventType: "AI_REASONING_STARTED",
  });
  const aiOutcome = await runSecurityReasoning({
    plan,
    findings: allFindings,
    coverage,
    confirmedAttackChains: (chainRows ?? []).length,
  }).catch((error): Awaited<ReturnType<typeof runSecurityReasoning>> => ({
    status: "FAILED",
    reason: error instanceof Error ? error.message : String(error),
    durationMs: Date.now() - aiReasoningStart,
  }));
  const aiReasoningDurationMs = Date.now() - aiReasoningStart;

  if (aiOutcome.status === "COMPLETED") {
    await recordOrchestratorEvent(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      eventType: "AI_REASONING_COMPLETED",
      detail: { provider: aiOutcome.provider, model: aiOutcome.model, confidence: aiOutcome.result.confidence },
    });
    // Section 15/16: every AI-proposed investigation goes through the SAME
    // deterministic gate as any other trigger -- the LLM can recommend,
    // never execute. Today this always rejects (network enforcement is
    // honestly false), exactly like runAdaptiveInvestigation's own findings.
    for (const rec of aiOutcome.result.investigationRecommendations) {
      await recordOrchestratorEvent(admin, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        scanId: input.scanId,
        eventType: "AI_INVESTIGATION_PROPOSED",
        detail: { reason: rec.reason, requiredCapability: rec.requiredCapability, findingIds: rec.findingIds },
      });
      await recordOrchestratorEvent(admin, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        scanId: input.scanId,
        eventType: "AI_INVESTIGATION_REJECTED",
        detail: { reason: "Real network egress enforcement is not active -- AI-proposed investigations cannot execute, same rule as deterministic triggers (section 15)." },
      });
    }
  } else if (aiOutcome.status === "TIMED_OUT") {
    timeouts += 1;
    await recordOrchestratorEvent(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      eventType: "AI_REASONING_TIMEOUT",
      detail: { reason: aiOutcome.reason },
    });
  } else if (aiOutcome.status === "FAILED") {
    await recordOrchestratorEvent(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      eventType: "AI_REASONING_FAILED",
      detail: { reason: aiOutcome.reason },
    });
  }

  // --- PRODUCTION VERDICT (section 22: reused, never re-created) --------
  const verdictStart = Date.now();
  const verdict = await getCurrentProductionVerdict(admin, input.organizationId, input.projectId).catch(() => null);
  const verdictDurationMs = Date.now() - verdictStart;
  await recordOrchestratorEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    eventType: "VERDICT_GENERATED",
    detail: { status: verdict?.status ?? null, score: verdict?.score ?? null },
  });

  const totalDurationMs = Date.now() - totalStart;

  return {
    plan,
    coverage,
    investigations,
    aiReasoning: aiOutcome,
    verdictStatus: verdict?.status ?? null,
    verdictScore: verdict?.score ?? null,
    verdictNote:
      "This verdict now includes external-engine findings (OpenGrep/Trivy/Crypto/Scorecard) folded into the native scoring model (Phase 37, workstream C) -- deduplicated against native findings via finding_correlations, so a corroborated issue is never double-counted. AI reasoning above is advisory only and cannot change this score.",
    telemetry: {
      discoveryDurationMs,
      planningDurationMs,
      queueLatencyMs,
      engineDurationMs,
      correlationDurationMs,
      attackChainDurationMs,
      aiReasoningDurationMs,
      verdictDurationMs,
      totalDurationMs,
      parallelism: engineIds.length,
      engineFailures,
      timeouts,
      retries: 0,
    },
    jobsCreated,
  };
}
