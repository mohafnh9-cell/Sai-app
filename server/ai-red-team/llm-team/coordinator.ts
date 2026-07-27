import { randomUUID } from "node:crypto";
import { createRedTeamLogger } from "../logging/red-team-logger";
import { LLM_TEAM_ANALYSIS_PHASE } from "./llm-team.config";
import type { LlmTeamInput, LlmTeamResult } from "./llm-team.types";
import { runLlmDeclarativePipeline } from "./declarative/run-declarative-pipeline";

export class LlmTeamCoordinator {
  async run(input: LlmTeamInput): Promise<LlmTeamResult> {
    const logger = createRedTeamLogger();
    const llmTeamRunId = randomUUID();
    const startedAt = Date.now();

    if (input.signal?.aborted) {
      const durationMs = Date.now() - startedAt;
      logger.log({
        event: "llm_team_completed",
        requestId: input.requestId,
        metadata: {
          llmTeamRunId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          status: "skipped",
          skippedReason: "aborted",
          durationMs,
        },
      });
      return {
        llmTeamRunId,
        status: "skipped",
        skippedReason: "Run aborted before LLM Team execution.",
        analysisPhase: LLM_TEAM_ANALYSIS_PHASE,
        executionMode: "skipped",
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
        durationMs,
      };
    }

    try {
      const { result, pipeline } = await runLlmDeclarativePipeline({
        ...input,
        llmTeamRunId,
      });
      const durationMs = Date.now() - startedAt;

      logger.log({
        event: "llm_team_completed",
        requestId: input.requestId,
        metadata: {
          llmTeamRunId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          status: result.status,
          findingsCount: result.findingsCount,
          durationMs,
          declarativePipelineStatus: pipeline.status,
        },
      });

      return { ...result, durationMs };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      logger.log({
        event: "llm_team_completed",
        requestId: input.requestId,
        metadata: {
          llmTeamRunId,
          status: "failed",
          message: err instanceof Error ? err.message : "llm_team_failed",
          durationMs,
        },
      });
      return {
        llmTeamRunId,
        status: "failed",
        skippedReason: err instanceof Error ? err.message : "LLM Team pipeline failed.",
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
        durationMs,
      };
    }
  }
}

export function createLlmTeamCoordinator(): LlmTeamCoordinator {
  return new LlmTeamCoordinator();
}
