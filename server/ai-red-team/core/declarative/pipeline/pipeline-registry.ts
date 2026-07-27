import type { CapabilityRegistry } from "../../capabilities/capability-registry";
import { createPipelinePlanner, type PipelinePlan } from "./pipeline-planner";
import { createPipelineValidator } from "./pipeline-validator";
import {
  PipelineExecutor,
} from "./pipeline-executor";
import type { PipelineExecuteInput, PipelineExecutorOptions } from "./pipeline.types";

export class PipelineRegistry {
  private readonly plans = new Map<string, PipelinePlan>();

  registerPlan(plan: PipelinePlan): void {
    this.plans.set(plan.definition.manifestId, plan);
  }

  getPlan(manifestId: string): PipelinePlan | null {
    return this.plans.get(manifestId) ?? null;
  }
}

export function createPipelineRegistry(): PipelineRegistry {
  return new PipelineRegistry();
}

export type DeclarativePipelineRunner = {
  plan: PipelinePlan;
  execute: (input: PipelineExecuteInput) => Promise<import("./pipeline.types").PipelineResult>;
};

export function createDeclarativePipelineRunner(input: {
  manifestId: string;
  rootCapabilityId: string;
  registry: CapabilityRegistry;
  handlers: import("./pipeline.types").PipelineStageHandlers;
  supportedStageIds?: import("../canonical-stages").CanonicalPipelineStageId[];
  options?: PipelineExecutorOptions;
}): DeclarativePipelineRunner {
  const planner = createPipelinePlanner();
  const validator = createPipelineValidator();
  const plan = planner.plan({
    manifestId: input.manifestId,
    registry: input.registry,
    rootCapabilityId: input.rootCapabilityId,
    supportedStageIds: input.supportedStageIds,
  });
  const issues = validator.validate(plan.definition);
  if (issues.length > 0) {
    plan.explainability.push(...issues.map((i) => `Validation: ${i.message}`));
  }
  const executor = new PipelineExecutor(input.handlers, input.options);
  return {
    plan,
    execute: (executeInput) => executor.execute(plan, executeInput),
  };
}
