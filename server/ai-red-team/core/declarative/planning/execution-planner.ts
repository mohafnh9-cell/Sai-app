import type { CapabilityRegistry } from "../../capabilities/capability-registry";
import type { CapabilityResolution } from "../../capabilities/capability.types";
import type { PipelinePlan } from "../pipeline/pipeline-planner";
import type { CanonicalPipelineStageId } from "../canonical-stages";

export class CapabilityResolver {
  resolve(registry: CapabilityRegistry, rootCapabilityIds: string[]): CapabilityResolution {
    const explainability: string[] = [];
    const ordered: string[] = [];
    const missing = new Set<string>();
    const conflicts: CapabilityResolution["conflicts"] = [];

    for (const root of rootCapabilityIds) {
      const resolution = registry.resolveDependencies([root]);
      explainability.push(...resolution.explainability);
      for (const id of resolution.orderedCapabilityIds) {
        if (!ordered.includes(id)) ordered.push(id);
      }
      for (const m of resolution.missing) missing.add(m);
      conflicts.push(...resolution.conflicts);
    }

    return {
      orderedCapabilityIds: ordered,
      satisfied: ordered.filter((id) => registry.getCapability(id)),
      missing: [...missing],
      conflicts,
      explainability,
    };
  }
}

export class DependencyResolver {
  resolveStageOrder(plan: PipelinePlan): CanonicalPipelineStageId[] {
    return [...plan.orderedStageIds];
  }
}

export type ExecutionPlan = {
  planId: string;
  manifestId: string;
  stageOrder: CanonicalPipelineStageId[];
  estimatedDurationMs: number;
  capabilityResolution: CapabilityResolution;
  explainability: string[];
};

export class ExecutionGraphBuilder {
  build(plan: PipelinePlan): { nodes: string[]; edges: Array<{ from: string; to: string }> } {
    const nodes = plan.orderedStageIds;
    const edges: Array<{ from: string; to: string }> = [];
    for (let i = 1; i < nodes.length; i++) {
      edges.push({ from: nodes[i - 1]!, to: nodes[i]! });
    }
    return { nodes, edges };
  }
}

export class PipelineOptimizer {
  optimize(plan: PipelinePlan, contextArtifacts: Record<string, unknown>): PipelinePlan {
    const skipped = [...plan.skippedStageIds];
    for (const stageId of plan.orderedStageIds) {
      const key = `artifact:${stageId}`;
      if (contextArtifacts[key] != null) {
        skipped.push({ id: stageId, reason: "Reusing existing artifact (optimizer)." });
      }
    }
    const skipIds = new Set(skipped.map((s) => s.id));
    return {
      ...plan,
      orderedStageIds: plan.orderedStageIds.filter((id) => !skipIds.has(id)),
      skippedStageIds: skipped,
      explainability: [...plan.explainability, "Pipeline optimizer applied reuse skips."],
    };
  }
}

export class ExecutionScheduler {
  schedule(plan: ExecutionPlan): { sequential: CanonicalPipelineStageId[] } {
    return { sequential: plan.stageOrder };
  }
}

export class ExecutionPlanner {
  constructor(
    private readonly capabilityResolver = new CapabilityResolver(),
    private readonly graphBuilder = new ExecutionGraphBuilder()
  ) {}

  plan(input: {
    plan: PipelinePlan;
    registry: CapabilityRegistry;
    rootCapabilityId: string;
  }): ExecutionPlan {
    const capabilityResolution = this.capabilityResolver.resolve(input.registry, [
      input.rootCapabilityId,
    ]);
    const graph = this.graphBuilder.build(input.plan);
    const estimatedDurationMs = input.plan.orderedStageIds.length * 50;
    return {
      planId: `exec:${input.plan.definition.manifestId}:${Date.now()}`,
      manifestId: input.plan.definition.manifestId,
      stageOrder: input.plan.orderedStageIds,
      estimatedDurationMs,
      capabilityResolution,
      explainability: [
        ...input.plan.explainability,
        `Execution graph nodes: ${graph.nodes.join(" → ")}`,
      ],
    };
  }
}

export function createExecutionPlanner(): ExecutionPlanner {
  return new ExecutionPlanner();
}
