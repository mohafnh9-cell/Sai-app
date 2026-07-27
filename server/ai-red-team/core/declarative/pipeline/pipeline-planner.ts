import type { CapabilityRegistry } from "../../capabilities/capability-registry";
import type { PipelineDefinition, PipelineStageDefinition } from "./pipeline.types";
import {
  CANONICAL_PIPELINE_STAGE_ORDER,
  STAGE_CAPABILITY_MAP,
  type CanonicalPipelineStageId,
} from "../canonical-stages";

const STAGE_LABELS: Record<CanonicalPipelineStageId, string> = {
  discovery: "Discovery",
  graph: "Graph Construction",
  trust_boundaries: "Trust Boundaries",
  invariants: "Invariant Extraction",
  attack_generation: "Attack Generation",
  specialist_selection: "Specialist Selection",
  runtime_selection: "Runtime Selection",
  execution: "Safe Execution",
  evidence: "Evidence Collection",
  confidence: "Confidence Propagation",
  findings: "Findings Engine",
  replay: "Replay Generation",
  coverage: "Coverage Analysis",
  platform_integration: "Platform Integration",
};

export function buildDefaultStageDefinition(stageId: CanonicalPipelineStageId): PipelineStageDefinition {
  const caps = STAGE_CAPABILITY_MAP[stageId];
  return {
    id: stageId,
    name: STAGE_LABELS[stageId],
    version: { major: 1, minor: 0, patch: 0 },
    inputs: stageId === "discovery" ? ["discoveryReport"] : [`artifact:${previousStage(stageId)}`],
    outputs: [`artifact:${stageId}`],
    requiredCapabilities: caps.slice(0, 1),
    optionalCapabilities: caps.slice(1),
    executionMode: stageId === "platform_integration" ? "optional" : "required",
    estimatedCostMs: 50,
    priority: CANONICAL_PIPELINE_STAGE_ORDER.indexOf(stageId),
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    metadata: {},
  };
}

function previousStage(stageId: CanonicalPipelineStageId): string {
  const idx = CANONICAL_PIPELINE_STAGE_ORDER.indexOf(stageId);
  if (idx <= 0) return "input";
  return CANONICAL_PIPELINE_STAGE_ORDER[idx - 1]!;
}

export function buildPipelineDefinitionFromManifest(manifestId: string): PipelineDefinition {
  return {
    id: `pipeline:${manifestId}`,
    version: "1.0.0",
    manifestId,
    stages: CANONICAL_PIPELINE_STAGE_ORDER.map((id) => buildDefaultStageDefinition(id)),
    metadata: { generatedBy: "rt-core-declarative" },
  };
}

export type PipelinePlan = {
  definition: PipelineDefinition;
  orderedStageIds: CanonicalPipelineStageId[];
  skippedStageIds: Array<{ id: CanonicalPipelineStageId; reason: string }>;
  capabilityResolution: import("../../capabilities/capability.types").CapabilityResolution;
  explainability: string[];
};

export class PipelinePlanner {
  plan(input: {
    manifestId: string;
    registry: CapabilityRegistry;
    rootCapabilityId: string;
    supportedStageIds?: CanonicalPipelineStageId[];
  }): PipelinePlan {
    const definition = buildPipelineDefinitionFromManifest(input.manifestId);
    const supported = new Set(
      input.supportedStageIds ?? [...CANONICAL_PIPELINE_STAGE_ORDER]
    );
    const sortedSupported = [...supported].sort((a, b) => a.localeCompare(b));
    const stageCapabilityRoots = [
      input.rootCapabilityId,
      ...sortedSupported.flatMap((stageId) => STAGE_CAPABILITY_MAP[stageId]),
    ];
    const resolution = input.registry.resolveDependencies(
      [...new Set(stageCapabilityRoots)].sort((a, b) => a.localeCompare(b))
    );
    const satisfied = new Set(resolution.satisfied);
    const hasCapabilities = (stageId: CanonicalPipelineStageId) =>
      STAGE_CAPABILITY_MAP[stageId].every(
        (cap) => satisfied.has(cap) || Boolean(input.registry.getCapability(cap))
      );

    const skipped: PipelinePlan["skippedStageIds"] = [];
    const ordered: CanonicalPipelineStageId[] = [];

    for (const stageId of CANONICAL_PIPELINE_STAGE_ORDER) {
      if (!supported.has(stageId)) {
        skipped.push({ id: stageId, reason: "Stage not declared by manifest module bindings." });
        continue;
      }
      if (!hasCapabilities(stageId)) {
        const required = STAGE_CAPABILITY_MAP[stageId];
        const missing = required.filter(
          (cap) => !satisfied.has(cap) && !input.registry.getCapability(cap)
        );
        skipped.push({
          id: stageId,
          reason: `Missing capabilities: ${missing.join(", ")}`,
        });
        continue;
      }
      ordered.push(stageId);
    }

    return {
      definition,
      orderedStageIds: ordered,
      skippedStageIds: skipped,
      capabilityResolution: resolution,
      explainability: [
        `Planned pipeline for ${input.manifestId}`,
        ...resolution.explainability,
        ...skipped.map((s) => `Skip ${s.id}: ${s.reason}`),
      ],
    };
  }
}

export function createPipelinePlanner(): PipelinePlanner {
  return new PipelinePlanner();
}
