import type { DiscoveryReport } from "../../discovery/types";
import { runRt10SpecialistPlanningPipeline } from "../pipeline/rt10-coordinator";
import { specialistContextFromGraph } from "../specialists/specialist-context";
import { stableAiId } from "../model/stable-id";
import {
  DEFAULT_AI_RUNTIME_BUDGET,
  DEFAULT_AI_RUNTIME_LIMITS,
  DEFAULT_AI_RUNTIME_PROFILE,
} from "./runtime.config";
import type { AIRuntimeContext } from "./runtime.types";
import { runAiSafeRuntime } from "./ai-runtime";

export async function runRt10SafeRuntimePipeline(discovery: DiscoveryReport) {
  const prior = await runRt10SpecialistPlanningPipeline(discovery);
  const base = specialistContextFromGraph({
    discovery,
    inventory: prior.inventory,
    graph: prior.graph,
    invariants: prior.invariants,
    attacks: prior.attacks,
  });

  const context: AIRuntimeContext = {
    llmTeamRunId: stableAiId(`llm-run:${prior.graph.id}`),
    organizationId: base.organizationId,
    projectId: base.projectId,
    graph: base.graph,
    invariants: base.invariants,
    attacks: base.attacks,
    specialistSummary: prior.specialistSummary,
    profile: DEFAULT_AI_RUNTIME_PROFILE,
    budget: DEFAULT_AI_RUNTIME_BUDGET,
    limits: DEFAULT_AI_RUNTIME_LIMITS,
  };

  const runtimeSummary = await runAiSafeRuntime({ context });
  return { ...prior, runtimeSummary };
}

export const AIRuntimePipeline = {
  runSafeRuntime: runRt10SafeRuntimePipeline,
};
