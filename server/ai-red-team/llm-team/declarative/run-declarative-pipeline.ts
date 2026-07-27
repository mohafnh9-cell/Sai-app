import type { LlmTeamInput, LlmTeamResult } from "../llm-team.types";
import { LLM_TEAM_ANALYSIS_PHASE, LLM_TEAM_GRAPH_DEFERRAL } from "../llm-team.config";
import { isLlmTeamAnalysisOnly } from "../integration/feature-gate";
import { createLlmTeamCapabilityRegistry } from "../capabilities/register-llm-capabilities";
import {
  executePluginPipeline,
  globalPluginRegistry,
} from "../../core/declarative/plugin/plugin-registry";
import type { PipelineContext } from "../../core/declarative/pipeline/pipeline.types";
import { RT10_LLM_MANIFEST } from "./manifest";
import "./register";

const PLUGIN_ID = "rt10.llm.plugin";

export async function runLlmDeclarativePipeline(input: LlmTeamInput & { llmTeamRunId: string }): Promise<{
  pipeline: Awaited<ReturnType<typeof executePluginPipeline>>;
  result: LlmTeamResult;
}> {
  const plugin = globalPluginRegistry.get(PLUGIN_ID)!;
  const capabilityRegistry = createLlmTeamCapabilityRegistry();

  const context: PipelineContext = {
    runId: input.runId,
    requestId: input.requestId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    signal: input.signal,
    artifacts: { discoveryReport: input.discoveryReport },
    metadata: { llmTeamRunId: input.llmTeamRunId, plan: input.plan },
  };

  const pipeline = await executePluginPipeline({ plugin, capabilityRegistry, context });

  const inventory = pipeline.context.artifacts.inventory;
  if (!inventory || pipeline.stageResults.some((s) => s.stageId === "discovery" && s.status === "skipped")) {
    return {
      pipeline,
      result: {
        llmTeamRunId: input.llmTeamRunId,
        status: "skipped",
        skippedReason: LLM_TEAM_GRAPH_DEFERRAL,
        analysisPhase: LLM_TEAM_ANALYSIS_PHASE,
        executionMode: "analysis",
        findingsCount: 0,
        graphNodeCount: 0,
        graphEdgeCount: 0,
        trustBoundaryCount: 0,
        invariantsExtracted: 0,
        attackCasesGenerated: 0,
        specialistsCompleted: 0,
        specialistsSkipped: 0,
        specialistsFailed: 0,
        runtimeExecutionsCompleted: 0,
        runtimeFailures: 0,
        durationMs: pipeline.durationMs,
        inventory: inventory as never,
      },
    };
  }

  if (pipeline.status === "failed") {
    return {
      pipeline,
      result: {
        llmTeamRunId: input.llmTeamRunId,
        status: "failed",
        skippedReason: pipeline.stageResults.find((s) => s.status === "failed")?.skipReason ?? "pipeline_failed",
        analysisPhase: LLM_TEAM_ANALYSIS_PHASE,
        executionMode: "failed",
        findingsCount: 0,
        graphNodeCount: 0,
        graphEdgeCount: 0,
        trustBoundaryCount: 0,
        invariantsExtracted: 0,
        attackCasesGenerated: 0,
        specialistsCompleted: 0,
        specialistsSkipped: 0,
        specialistsFailed: 0,
        runtimeExecutionsCompleted: 0,
        runtimeFailures: 0,
        durationMs: pipeline.durationMs,
      },
    };
  }

  const graph = pipeline.context.artifacts.graph as import("../model/execution-graph.types").AIExecutionGraph;
  const invariants = pipeline.context.artifacts.invariants as import("../invariants/invariant.types").AIInvariantCollection;
  const attacks = pipeline.context.artifacts.attacks as import("../attacks/attack.types").AIAttackCollection;
  const specialistSummary = pipeline.context.artifacts.specialistSummary as import("../specialists/specialist.types").AISpecialistExecutionSummary;
  const runtimeSummary = pipeline.context.artifacts.runtimeSummary as import("../runtime/runtime.types").AIRuntimeSummary;
  const findings = pipeline.context.artifacts.findings as import("../findings/finding.types").AIFindingCollection;
  const analysisOnly = isLlmTeamAnalysisOnly({ organizationId: input.organizationId });

  return {
    pipeline,
    result: {
      llmTeamRunId: input.llmTeamRunId,
      status: "completed",
      analysisPhase: LLM_TEAM_ANALYSIS_PHASE,
      executionMode: analysisOnly ? "analysis_only" : "full",
      findingsCount: findings?.findings.length ?? 0,
      graphNodeCount: graph?.nodes.length ?? 0,
      graphEdgeCount: graph?.edges.length ?? 0,
      trustBoundaryCount: graph?.boundaries.length ?? 0,
      invariantsExtracted: invariants?.invariants.length ?? 0,
      attackCasesGenerated: attacks?.cases.length ?? 0,
      specialistsCompleted: specialistSummary?.specialistsCompleted ?? 0,
      specialistsSkipped: specialistSummary?.specialistsSkipped ?? 0,
      specialistsFailed: specialistSummary?.specialistsFailed ?? 0,
      runtimeExecutionsCompleted: runtimeSummary?.plansCompleted ?? 0,
      runtimeFailures: runtimeSummary?.failedExecutions ?? 0,
      durationMs: pipeline.durationMs,
      inventory: inventory as never,
      graph,
      invariants,
      attacks,
      specialistSummary,
      runtimeSummary,
      findings,
    },
  };
}
