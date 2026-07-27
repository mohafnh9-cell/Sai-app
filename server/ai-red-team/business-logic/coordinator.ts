import { randomUUID } from "node:crypto";
import { createRedTeamLogger } from "../logging/red-team-logger";
import type { BusinessLogicTeamInput, BusinessLogicTeamResult } from "./business-logic.types";
import { BUSINESS_LOGIC_ANALYSIS_PHASE } from "./business-logic.config";
import type { BusinessLogicSpecialistRegistry } from "./registry/business-logic-specialist-registry";
import {
  createBusinessLogicSpecialistRegistry,
  createDefaultBusinessLogicSpecialists,
} from "./registry";
import { runBusinessLogicDeclarativePipeline } from "./declarative/run-declarative-pipeline";

export type BusinessLogicTeamCoordinatorDeps = {
  registry?: BusinessLogicSpecialistRegistry;
  logger?: ReturnType<typeof createRedTeamLogger>;
};

export class BusinessLogicTeamCoordinator {
  private readonly registry: BusinessLogicSpecialistRegistry;

  constructor(private readonly deps: BusinessLogicTeamCoordinatorDeps = {}) {
    this.registry =
      deps.registry ??
      createBusinessLogicSpecialistRegistry(createDefaultBusinessLogicSpecialists());
  }

  async run(input: BusinessLogicTeamInput): Promise<BusinessLogicTeamResult> {
    const logger = this.deps.logger ?? createRedTeamLogger();
    const businessLogicTeamRunId = randomUUID();
    const startedAt = Date.now();

    if (input.signal?.aborted) {
      const durationMs = Date.now() - startedAt;
      logger.log({
        event: "business_logic_team_completed",
        requestId: input.requestId,
        metadata: {
          businessLogicRunId: businessLogicTeamRunId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          status: "skipped",
          skippedReason: "aborted",
          durationMs,
        },
      });
      return {
        businessLogicTeamRunId,
        status: "skipped",
        skippedReason: "Run aborted before Business Logic Team execution.",
        analysisPhase: BUSINESS_LOGIC_ANALYSIS_PHASE,
        executionMode: "analysis",
        findingsCount: 0,
        workflowsDiscovered: 0,
        invariantsExtracted: 0,
        abuseHypothesesGenerated: 0,
        specialistObservationsGenerated: 0,
        specialistsCompleted: 0,
        runtimeExecutionsCompleted: 0,
        durationMs,
      };
    }

    const { result, pipeline } = await runBusinessLogicDeclarativePipeline(
      {
        ...input,
        businessLogicTeamRunId,
      },
      this.registry
    );

    logger.log({
      event: "business_logic_team_completed",
      requestId: input.requestId,
      metadata: {
        businessLogicRunId: businessLogicTeamRunId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        status: result.status,
        executionMode: result.executionMode,
        analysisPhase: result.analysisPhase,
        workflowsDiscovered: result.workflowsDiscovered,
        invariantsExtracted: result.invariantsExtracted,
        abuseHypothesesGenerated: result.abuseHypothesesGenerated,
        specialistsCompleted: result.specialistsCompleted,
        runtimeExecutionsCompleted: result.runtimeExecutionsCompleted,
        findingsCount: result.findingsCount,
        deferralReason: result.deferralReason ?? null,
        durationMs: result.durationMs,
        declarativePipeline: pipeline.metadata.explainability.slice(-3),
      },
    });

    return result;
  }
}

export function createBusinessLogicTeamCoordinator(
  deps?: BusinessLogicTeamCoordinatorDeps
): BusinessLogicTeamCoordinator {
  return new BusinessLogicTeamCoordinator(deps);
}
