import type { DiscoveryReport } from "../../discovery/types";
import { buildAiDiscoveryInventory } from "../discovery/build-ai-discovery";
import { buildAiExecutionGraph } from "../model/build-execution-graph";
import { extractAiTrustInvariants } from "../invariants/invariant-extractor";
import { generateAiAttackCases } from "../attacks/attack-generator";
import { createDefaultAiSpecialistRegistry } from "../registry/register-default-specialists";
import { specialistContextFromGraph } from "../specialists/specialist-context";
import { runAiSecuritySpecialists } from "../specialists/specialist-runner";
import type { AISpecialistExecutionSummary } from "../specialists/specialist.types";
import type { AIExecutionGraph } from "../model/execution-graph.types";
import type { AIInvariantCollection } from "../invariants/invariant.types";
import type { AIAttackCollection } from "../attacks/attack.types";
import type { AiDiscoveryInventory } from "../discovery/discovery.types";

export type Rt10SpecialistPlanningPipelineResult = {
  inventory: AiDiscoveryInventory;
  graph: AIExecutionGraph;
  invariants: AIInvariantCollection;
  attacks: AIAttackCollection;
  specialistSummary: AISpecialistExecutionSummary;
};

/** RT10 coordinator slice 5 — through specialist planning (no runtime). */
export async function runRt10SpecialistPlanningPipeline(
  discovery: DiscoveryReport
): Promise<Rt10SpecialistPlanningPipelineResult> {
  const inventory = buildAiDiscoveryInventory(discovery);
  const graph = buildAiExecutionGraph(inventory);
  const invariants = extractAiTrustInvariants({ graph });
  const attacks = generateAiAttackCases({ graph, invariants }).collection;
  const context = specialistContextFromGraph({ discovery, inventory, graph, invariants, attacks });
  const registry = createDefaultAiSpecialistRegistry();
  const specialistSummary = await runAiSecuritySpecialists({ registry, context });
  return { inventory, graph, invariants, attacks, specialistSummary };
}

import { runRt10SafeRuntimePipeline } from "../runtime/ai-runtime-coordinator";
import { runRt10FindingsPipeline } from "../findings/findings-pipeline";

export { runRt10SafeRuntimePipeline, runRt10FindingsPipeline };

export const Rt10AnalysisCoordinator = {
  runSpecialistPlanning: runRt10SpecialistPlanningPipeline,
  runSafeRuntime: runRt10SafeRuntimePipeline,
  runFindings: runRt10FindingsPipeline,
};
