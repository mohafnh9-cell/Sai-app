import type { BusinessLogicTeamInput, BusinessLogicTeamResult } from "../business-logic.types";
import type { BusinessLogicTeamContext } from "../discovery/discovery.types";
import {
  BUSINESS_LOGIC_ANALYSIS_PHASE,
  BUSINESS_LOGIC_NO_WORKFLOWS_DEFERRAL,
  BUSINESS_LOGIC_PIPELINE_COMPLETE_DEFERRAL,
} from "../business-logic.config";
import type { BusinessLogicSpecialistRegistry } from "../registry/business-logic-specialist-registry";
import { createBusinessLogicCapabilityRegistry } from "../capabilities/register-business-logic-capabilities";
import { executePluginPipeline, globalPluginRegistry } from "../../core/declarative/plugin/plugin-registry";
import type { PipelineContext } from "../../core/declarative/pipeline/pipeline.types";
import { CANONICAL_PIPELINE_STAGE_ORDER } from "../../core/declarative/canonical-stages";
import { RT9_BUSINESS_LOGIC_MANIFEST, RT9_ROOT_CAPABILITY_ID } from "./manifest";
import { createRt9StageHandlers } from "./stage-handlers";

const PLUGIN_ID = "rt9.business_logic.plugin";

export function registerRt9Plugin(registry: BusinessLogicSpecialistRegistry): void {
  globalPluginRegistry.register({
    pluginId: PLUGIN_ID,
    manifest: RT9_BUSINESS_LOGIC_MANIFEST,
    handlers: createRt9StageHandlers(registry),
    supportedStageIds: [...CANONICAL_PIPELINE_STAGE_ORDER],
    rootCapabilityId: RT9_ROOT_CAPABILITY_ID,
    metadata: { autoRegistered: true },
  });
}

export async function runBusinessLogicDeclarativePipeline(
  input: BusinessLogicTeamInput & { businessLogicTeamRunId: string },
  specialistRegistry: BusinessLogicSpecialistRegistry
): Promise<{
  pipeline: Awaited<ReturnType<typeof executePluginPipeline>>;
  result: BusinessLogicTeamResult;
}> {
  registerRt9Plugin(specialistRegistry);
  const plugin = globalPluginRegistry.get(PLUGIN_ID)!;
  const capabilityRegistry = createBusinessLogicCapabilityRegistry();

  const context: PipelineContext = {
    runId: input.runId,
    requestId: input.requestId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    signal: input.signal,
    artifacts: { discoveryReport: input.discoveryReport },
    metadata: { businessLogicTeamRunId: input.businessLogicTeamRunId, plan: input.plan },
  };

  const pipeline = await executePluginPipeline({ plugin, capabilityRegistry, context });
  const teamContext = pipeline.context.artifacts.teamContext as BusinessLogicTeamContext | undefined;

  if (!teamContext || teamContext.workflows.length === 0) {
    return {
      pipeline,
      result: {
        businessLogicTeamRunId: input.businessLogicTeamRunId,
        status: "completed",
        deferralReason: BUSINESS_LOGIC_NO_WORKFLOWS_DEFERRAL,
        analysisPhase: BUSINESS_LOGIC_ANALYSIS_PHASE,
        executionMode: "analysis",
        findingsCount: 0,
        workflowsDiscovered: 0,
        invariantsExtracted: 0,
        abuseHypothesesGenerated: 0,
        specialistObservationsGenerated: 0,
        specialistsCompleted: 0,
        runtimeExecutionsCompleted: 0,
        durationMs: pipeline.durationMs,
        context: teamContext,
      },
    };
  }

  if (pipeline.status === "failed") {
    return {
      pipeline,
      result: {
        businessLogicTeamRunId: input.businessLogicTeamRunId,
        status: "failed",
        skippedReason: pipeline.stageResults.find((s) => s.status === "failed")?.skipReason ?? "pipeline_failed",
        analysisPhase: BUSINESS_LOGIC_ANALYSIS_PHASE,
        executionMode: "analysis",
        findingsCount: 0,
        workflowsDiscovered: teamContext.workflows.length,
        invariantsExtracted: 0,
        abuseHypothesesGenerated: 0,
        specialistObservationsGenerated: 0,
        specialistsCompleted: 0,
        runtimeExecutionsCompleted: 0,
        durationMs: pipeline.durationMs,
        context: teamContext,
      },
    };
  }

  const domain = teamContext.domainModel;
  const deferralReason = BUSINESS_LOGIC_PIPELINE_COMPLETE_DEFERRAL;

  return {
    pipeline,
    result: {
      businessLogicTeamRunId: input.businessLogicTeamRunId,
      status: "completed",
      analysisPhase: BUSINESS_LOGIC_ANALYSIS_PHASE,
      executionMode: "analysis",
      deferralReason,
      findingsCount: domain?.findingCollection?.findings.length ?? 0,
      workflowsDiscovered: teamContext.workflows.length,
      invariantsExtracted: domain?.invariantCollection?.invariants.length ?? 0,
      abuseHypothesesGenerated: domain?.abuseCollection?.cases.length ?? 0,
      specialistObservationsGenerated: domain?.specialistExecution?.observationCount ?? 0,
      specialistsCompleted: domain?.specialistExecution?.specialistsCompleted ?? 0,
      runtimeExecutionsCompleted: domain?.runtimeExecution?.plansCompleted ?? 0,
      durationMs: pipeline.durationMs,
      context: teamContext,
    },
  };
}
