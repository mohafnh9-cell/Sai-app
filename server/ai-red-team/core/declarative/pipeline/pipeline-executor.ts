import type { PipelinePlan } from "./pipeline-planner";
import type {
  PipelineContext,
  PipelineExecuteInput,
  PipelineExecutorOptions,
  PipelineResult,
  PipelineStageHandlers,
  PipelineStageOutcome,
  PipelineStageResult,
} from "./pipeline.types";

const DEFAULT_OPTIONS: Required<PipelineExecutorOptions> = {
  reuseArtifacts: true,
  mergeCompatibleExecutions: true,
};

export class PipelineExecutor {
  constructor(
    private readonly handlers: PipelineStageHandlers,
    private readonly options: PipelineExecutorOptions = {}
  ) {}

  async execute(plan: PipelinePlan, input: PipelineExecuteInput): Promise<PipelineResult> {
    const startedAt = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...this.options };
    const stageResults: PipelineStageResult[] = [];
    const reusedArtifacts: string[] = [];
    const skippedStages: string[] = plan.skippedStageIds.map((s) => s.id);
    let failed = false;

    for (const skipped of plan.skippedStageIds) {
      stageResults.push({
        stageId: skipped.id,
        status: "skipped",
        durationMs: 0,
        skipReason: skipped.reason,
      });
    }

    for (const stageId of plan.orderedStageIds) {
      if (input.context.signal?.aborted) {
        stageResults.push({
          stageId,
          status: "skipped",
          durationMs: 0,
          skipReason: "aborted",
        });
        continue;
      }

      const artifactKey = `artifact:${stageId}`;
      if (opts.reuseArtifacts && input.context.artifacts[artifactKey] != null) {
        reusedArtifacts.push(artifactKey);
        stageResults.push({
          stageId,
          status: "completed",
          durationMs: 0,
          reused: true,
        });
        continue;
      }

      const handler = this.handlers[stageId];
      if (!handler) {
        stageResults.push({
          stageId,
          status: "skipped",
          durationMs: 0,
          skipReason: "No stage handler registered for plugin.",
        });
        skippedStages.push(stageId);
        continue;
      }

      const stageStarted = Date.now();
      let outcome: PipelineStageOutcome;
      try {
        outcome = await handler(input.context);
      } catch (err) {
        failed = true;
        stageResults.push({
          stageId,
          status: "failed",
          durationMs: Date.now() - stageStarted,
          skipReason: err instanceof Error ? err.message : "stage_failed",
        });
        break;
      }

      if (outcome.outputs) {
        for (const [key, value] of Object.entries(outcome.outputs)) {
          input.context.artifacts[key] = value;
        }
        if (outcome.outputs[artifactKey] !== undefined) {
          input.context.artifacts[artifactKey] = outcome.outputs[artifactKey];
        } else if (outcome.status === "completed") {
          input.context.artifacts[artifactKey] = outcome.outputs;
        }
      }

      stageResults.push({
        stageId,
        status: outcome.status,
        durationMs: Date.now() - stageStarted,
        skipReason: outcome.skipReason,
        outputs: outcome.outputs,
        reused: outcome.reuseExisting ?? false,
      });

      if (outcome.status === "failed") {
        failed = true;
        break;
      }
      if (outcome.status === "skipped") {
        skippedStages.push(stageId);
      }
    }

    const allSkipped =
      plan.orderedStageIds.length > 0 &&
      plan.orderedStageIds.every((id) => skippedStages.includes(id));

    const status = failed
      ? "failed"
      : allSkipped
        ? "skipped"
        : skippedStages.length > 0
          ? "partial"
          : "completed";

    return {
      status,
      stageResults,
      context: input.context,
      metadata: {
        plannedAt: new Date(startedAt).toISOString(),
        manifestId: plan.definition.manifestId,
        manifestVersion: plan.definition.version,
        stageCount: plan.orderedStageIds.length,
        skippedStages,
        reusedArtifacts,
        explainability: plan.explainability,
      },
      durationMs: Date.now() - startedAt,
    };
  }
}
