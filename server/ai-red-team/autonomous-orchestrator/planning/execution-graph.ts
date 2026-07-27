import type {
  ExecutionGraphEdge,
  ExecutionGraphNode,
  ExecutionWave,
  OrchestratorTeamId,
  TeamSelection,
} from "../aso.types";

const POST_PIPELINE: OrchestratorTeamId[] = [
  "intelligence",
  "decision",
  "engineering",
  "replay",
  "verdict",
];

export function buildExecutionGraph(selections: TeamSelection[]): {
  nodes: ExecutionGraphNode[];
  edges: ExecutionGraphEdge[];
} {
  const nodes: ExecutionGraphNode[] = [{ id: "node-discovery", teamId: "browser", label: "Discovery" }];
  const edges: ExecutionGraphEdge[] = [];

  const attackOrder: OrchestratorTeamId[] = [
    "browser",
    "authentication",
    "api",
    "authorization",
    "business_logic",
    "llm",
    "adversarial",
  ];

  let prev = "node-discovery";
  for (const teamId of attackOrder) {
    const sel = selections.find((s) => s.teamId === teamId);
    if (!sel?.selected) continue;
    const nodeId = `node-${teamId}`;
    nodes.push({ id: nodeId, teamId, label: teamId.replace(/_/g, " ") });
    edges.push({ from: prev, to: nodeId, kind: "depends_on" });
    prev = nodeId;
  }

  for (const teamId of POST_PIPELINE) {
    const nodeId = `node-${teamId}`;
    nodes.push({ id: nodeId, teamId, label: teamId });
    edges.push({ from: prev, to: nodeId, kind: "feeds" });
    prev = nodeId;
  }

  return { nodes, edges };
}

export function buildParallelWaves(input: {
  selections: TeamSelection[];
  parallelEnabled: boolean;
}): ExecutionWave[] {
  if (!input.parallelEnabled) {
    return buildExecutionGraph(input.selections).nodes
      .filter((n) => n.id !== "node-discovery")
      .map((n, i) => ({
        waveId: `wave-${i}`,
        nodeIds: [n.id],
        parallel: false,
      }));
  }

  const waves: ExecutionWave[] = [];
  const isSelected = (id: OrchestratorTeamId) =>
    input.selections.find((s) => s.teamId === id)?.selected ?? false;

  const wave1: string[] = [];
  if (isSelected("browser")) wave1.push("node-browser");
  if (isSelected("api")) wave1.push("node-api");
  if (isSelected("llm")) wave1.push("node-llm");
  if (wave1.length > 0) {
    waves.push({ waveId: "wave-parallel-1", nodeIds: wave1, parallel: wave1.length > 1 });
  }

  const sequentialAfter: OrchestratorTeamId[] = [
    "authentication",
    "authorization",
    "business_logic",
    "adversarial",
  ];
  for (const teamId of sequentialAfter) {
    if (!isSelected(teamId)) continue;
    waves.push({ waveId: `wave-${teamId}`, nodeIds: [`node-${teamId}`], parallel: false });
  }

  for (const teamId of POST_PIPELINE) {
    waves.push({ waveId: `wave-${teamId}`, nodeIds: [`node-${teamId}`], parallel: false });
  }

  return waves;
}

export function domainOrderFromGraph(selections: TeamSelection[]): import("../../types").AttackDomain[] {
  const order: import("../../types").AttackDomain[] = [
    "browser",
    "authentication",
    "api",
    "authorization",
    "payments",
    "llm",
  ];
  const selected = new Set(
    selections.filter((s) => s.selected && s.attackDomain).map((s) => s.attackDomain!)
  );
  return order.filter((d) => selected.has(d));
}
