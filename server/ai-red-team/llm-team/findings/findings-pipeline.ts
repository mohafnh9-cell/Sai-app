import type { DiscoveryReport } from "../../discovery/types";
import { runRt10SafeRuntimePipeline } from "../runtime/ai-runtime-coordinator";
import { buildAiFindings } from "./finding-builder";
import type { AIFindingCollection } from "../findings/finding.types";
import { stableAiId } from "../model/stable-id";

export async function runRt10FindingsPipeline(discovery: DiscoveryReport) {
  const prior = await runRt10SafeRuntimePipeline(discovery);
  const findings: AIFindingCollection = buildAiFindings({
    llmTeamRunId: stableAiId(`llm-run:${prior.graph.id}`),
    discovery,
    inventory: prior.inventory,
    graph: prior.graph,
    invariants: prior.invariants,
    attacks: prior.attacks,
    specialistSummary: prior.specialistSummary,
    runtimeSummary: prior.runtimeSummary,
  });

  return { ...prior, findings };
}

export const Rt10FindingsPipeline = {
  run: runRt10FindingsPipeline,
};
