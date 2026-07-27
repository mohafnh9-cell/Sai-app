import type { AIExecutionGraph } from "../model/execution-graph.types";
import type { AIInvariant } from "../invariants/invariant.types";
import type { AIAttackCase } from "../attacks/attack.types";
import type {
  AISpecialistArchitecture,
  AISpecialistContext,
  AISpecialistEligibility,
} from "./specialist.types";
import type { DiscoveredAiComponentKind } from "../discovery/discovery.types";

export function detectGraphArchitectures(graph: AIExecutionGraph): AISpecialistArchitecture[] {
  const out = new Set<AISpecialistArchitecture>();
  const kinds = new Set(graph.nodes.map((n) => n.kind));
  if (kinds.has("user_prompt") && kinds.has("llm")) out.add("chat");
  if (kinds.has("retrieved_context") || kinds.has("vector_store")) out.add("rag");
  if (kinds.has("tool")) out.add("tools");
  if (kinds.has("mcp_server") || kinds.has("mcp_client")) out.add("mcp");
  if (kinds.has("agent") || graph.agents.length > 0) out.add("agents");
  if (graph.edges.some((e) => e.kind === "streams")) out.add("streaming");
  if (kinds.has("memory")) out.add("memory_persistence");
  return [...out];
}

export function componentKindsInGraph(
  graph: AIExecutionGraph,
  inventoryKinds: DiscoveredAiComponentKind[]
): DiscoveredAiComponentKind[] {
  const nodeKinds = new Set(graph.nodes.map((n) => n.kind));
  const matched: DiscoveredAiComponentKind[] = [];
  for (const kind of inventoryKinds) {
    switch (kind) {
      case "llm_provider":
      case "inference_host":
        if (nodeKinds.has("llm")) matched.push(kind);
        break;
      case "vector_store":
        if (nodeKinds.has("vector_store")) matched.push(kind);
        break;
      case "knowledge_base":
        if (nodeKinds.has("knowledge_base")) matched.push(kind);
        break;
      case "mcp_server":
        if (nodeKinds.has("mcp_server")) matched.push(kind);
        break;
      case "mcp_client":
        if (nodeKinds.has("mcp_client")) matched.push(kind);
        break;
      case "agent_framework":
      case "ai_sdk":
        if (nodeKinds.has("agent") || graph.agents.length > 0) matched.push(kind);
        break;
      case "memory_store":
        if (nodeKinds.has("memory")) matched.push(kind);
        break;
      case "embedding_model":
        if (nodeKinds.has("embedding") || nodeKinds.has("vector_store")) matched.push(kind);
        break;
      default:
        break;
    }
  }
  return [...new Set(matched)];
}

export function selectInvariantsForSpecialist(input: {
  context: AISpecialistContext;
  categories: AIInvariant["category"][];
}): AIInvariant[] {
  const set = new Set(input.categories);
  return input.context.invariants.invariants.filter((i) => set.has(i.category));
}

export function selectAttacksForSpecialist(input: {
  context: AISpecialistContext;
  invariantIds: string[];
  categories?: AIAttackCase["category"][];
}): AIAttackCase[] {
  const invSet = new Set(input.invariantIds);
  const catSet = input.categories ? new Set(input.categories) : null;
  return input.context.attacks.cases.filter((c) => {
    if (!invSet.has(c.targetInvariantId)) return false;
    if (catSet && !catSet.has(c.category)) return false;
    return true;
  });
}

export function evaluateSpecialistEligibility(input: {
  context: AISpecialistContext;
  specialistLabel: string;
  supportedComponents: DiscoveredAiComponentKind[];
  supportedInvariantCategories: AIInvariant["category"][];
  supportedAttackCategories: AIAttackCase["category"][];
  supportedArchitectures: AISpecialistArchitecture[];
  requireGraphNodes?: string[];
}): AISpecialistEligibility {
  const { graph, inventory } = input.context;
  const architectures = detectGraphArchitectures(graph);
  const matchedArchitectures = architectures.filter((a) =>
    input.supportedArchitectures.includes(a)
  );

  const invariants = selectInvariantsForSpecialist({
    context: input.context,
    categories: input.supportedInvariantCategories,
  });
  const invariantIdSet = new Set(invariants.map((i) => i.id));
  const attackCategorySet = new Set(input.supportedAttackCategories);
  const attacks = input.context.attacks.cases.filter(
    (c) => attackCategorySet.has(c.category) && invariantIdSet.has(c.targetInvariantId)
  );

  const matchedNodeKinds = input.requireGraphNodes?.filter((k) =>
    graph.nodes.some((n) => n.kind === k)
  ) ?? [];

  const matchedComponents = componentKindsInGraph(graph, input.supportedComponents);
  const matchedBoundaryKinds = [
    ...new Set(
      invariants
        .map((i) => input.context.graph.boundaries.find((b) => b.id === i.protectedTrustBoundaryId)?.kind)
        .filter((k): k is string => Boolean(k))
    ),
  ];

  const matchedInvariantCategories = [...new Set(invariants.map((i) => i.category))];
  const matchedAttackCategories = [...new Set(attacks.map((a) => a.category))];

  const hasGraphStructure =
    graph.nodes.length > 0 &&
    (matchedArchitectures.length > 0 || matchedNodeKinds.length > 0) &&
    (invariants.length > 0 || attacks.length > 0);

  const hasRequiredNodes =
    !input.requireGraphNodes?.length ||
    input.requireGraphNodes.every((k) => graph.nodes.some((n) => n.kind === k));

  const eligible = hasGraphStructure && hasRequiredNodes && attacks.length > 0;

  if (!eligible) {
    return {
      eligible: false,
      reason: `${input.specialistLabel} skipped — insufficient graph-backed invariants/attacks (not SDK presence alone).`,
      matchedComponentKinds: matchedComponents,
      matchedNodeKinds,
      matchedBoundaryKinds: [],
      matchedArchitectures,
      matchedProviderFamilies: graph.context.providerFamilies,
      matchedInvariantCategories,
      matchedAttackCategories,
    };
  }

  return {
    eligible: true,
    reason: `${input.specialistLabel} selected — ${invariants.length} invariant(s), ${attacks.length} attack hypothesis(es), architectures: ${matchedArchitectures.join(", ") || "general"}.`,
    matchedComponentKinds: matchedComponents,
    matchedNodeKinds,
    matchedBoundaryKinds: graph.boundaries.map((b) => b.kind),
    matchedArchitectures,
    matchedProviderFamilies: graph.context.providerFamilies,
    matchedInvariantCategories,
    matchedAttackCategories,
  };
}

export function collectSpecialistEvidenceRefs(input: {
  invariants: AIInvariant[];
  attacks: AIAttackCase[];
}): string[] {
  const refs = new Set<string>();
  for (const inv of input.invariants) {
    for (const e of inv.evidence) refs.add(e.id);
  }
  for (const a of input.attacks) {
    for (const e of a.evidence) refs.add(e.id);
  }
  return [...refs];
}
