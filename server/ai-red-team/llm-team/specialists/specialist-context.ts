import type { DiscoveryReport } from "../../discovery/types";
import type { AiDiscoveryInventory } from "../discovery/discovery.types";
import type { AIExecutionGraph } from "../model/execution-graph.types";
import type { AIInvariantCollection } from "../invariants/invariant.types";
import type { AIAttackCollection } from "../attacks/attack.types";
import type { AISpecialistContext } from "./specialist.types";
import { stableAiId } from "../model/stable-id";

export function buildAiSpecialistContext(input: {
  llmTeamRunId: string;
  organizationId: string;
  projectId: string;
  discovery: DiscoveryReport;
  inventory: AiDiscoveryInventory;
  graph: AIExecutionGraph;
  invariants: AIInvariantCollection;
  attacks: AIAttackCollection;
}): AISpecialistContext {
  return {
    llmTeamRunId: input.llmTeamRunId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    discovery: input.discovery,
    inventory: input.inventory,
    graph: input.graph,
    invariants: input.invariants,
    attacks: input.attacks,
  };
}

export function specialistContextFromGraph(input: {
  discovery: DiscoveryReport;
  inventory: AiDiscoveryInventory;
  graph: AIExecutionGraph;
  invariants: AIInvariantCollection;
  attacks: AIAttackCollection;
}): AISpecialistContext {
  return buildAiSpecialistContext({
    llmTeamRunId: stableAiId(`llm-run:${input.graph.id}`),
    organizationId: input.discovery.organizationId,
    projectId: input.discovery.projectId,
    ...input,
  });
}
