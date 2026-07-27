export type {
  AttackGraph,
  AttackGraphBuilder,
  AttackGraphEdge,
  AttackGraphNode,
  PrioritizedFinding,
  RiskPrioritizer,
  UnifiedRedTeamVerdict,
  UnifiedRedTeamVerdictEngine,
  UnifiedRedTeamVerdictStatus,
} from "./interfaces";

export type * from "./models";
export { mergeGraphs } from "./graph";
export { buildGraphFromRun, buildIntelligenceAttackGraph } from "./graph-builder";
export { correlateFindings } from "./correlation-engine";
export { buildAttackChains } from "./attack-chain-builder";
export { assessBusinessImpact, aggregateRiskScore } from "./business-impact";
export { rankRemediationPriorities } from "./priority-engine";
export { scoreFindingConfidence, aggregateConfidence } from "./confidence-engine";
export { buildIntelligenceProductionVerdict } from "./production-verdict";
export { buildFounderExplanation } from "./explanation-engine";
export { linkFindingsToMemory } from "./memory-linker";
export { groupSafeFixPlans } from "./safe-fix-grouper";
export { summarizeRisk } from "./risk-engine";
export {
  SecurityIntelligenceEngine,
  createSecurityIntelligenceEngine,
  runSecurityIntelligence,
  toUnifiedRedTeamVerdict,
} from "./engine";
export { normalizeObservations, deduplicateObservations } from "./normalize-observations";

import type { AttackResult } from "../types";
import type { AttackGraphBuilder as LegacyAttackGraphBuilder } from "./interfaces";
import { buildGraphFromRun } from "./graph-builder";
import type { DiscoveryReport } from "../discovery/types";

/** Legacy RT1 adapter — maps intelligence graph to AttackGraph shape. */
export class LegacyAttackGraphAdapter implements LegacyAttackGraphBuilder {
  constructor(private readonly discovery: DiscoveryReport) {}

  async build(input: { results: AttackResult[] }) {
    const graph = buildGraphFromRun({ discovery: this.discovery, results: input.results });
    return {
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        domain: "browser" as const,
        label: n.label,
        metadata: { kind: n.kind, ...n.metadata },
      })),
      edges: graph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
    };
  }
}
