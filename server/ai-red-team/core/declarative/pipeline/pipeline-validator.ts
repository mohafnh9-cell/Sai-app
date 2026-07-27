import type { PipelineDefinition, PipelineStageDefinition } from "./pipeline.types";

export type PipelineValidationIssue = {
  stageId?: string;
  code: string;
  message: string;
};

export class PipelineValidator {
  validate(definition: PipelineDefinition): PipelineValidationIssue[] {
    const issues: PipelineValidationIssue[] = [];
    const ids = new Set<string>();
    for (const stage of definition.stages) {
      if (ids.has(stage.id)) {
        issues.push({
          stageId: stage.id,
          code: "duplicate_stage",
          message: `Duplicate stage id ${stage.id}`,
        });
      }
      ids.add(stage.id);
      if (stage.requiredCapabilities.length === 0 && stage.executionMode === "required") {
        issues.push({
          stageId: stage.id,
          code: "missing_capabilities",
          message: `Required stage ${stage.id} has no required capabilities.`,
        });
      }
    }
    return issues;
  }

  validateStage(stage: PipelineStageDefinition): PipelineValidationIssue[] {
    const issues: PipelineValidationIssue[] = [];
    if (stage.retryPolicy.maxAttempts < 1) {
      issues.push({
        stageId: stage.id,
        code: "invalid_retry",
        message: "maxAttempts must be >= 1",
      });
    }
    return issues;
  }
}

export function createPipelineValidator(): PipelineValidator {
  return new PipelineValidator();
}
