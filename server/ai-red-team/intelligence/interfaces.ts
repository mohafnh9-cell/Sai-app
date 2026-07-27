import type { AttackDomain, AttackFinding, AttackResult } from "../types";

export type AttackGraphNode = {
  id: string;
  domain: AttackDomain;
  label: string;
  metadata?: Record<string, unknown>;
};

export type AttackGraphEdge = {
  from: string;
  to: string;
  kind: string;
};

export type AttackGraph = {
  nodes: AttackGraphNode[];
  edges: AttackGraphEdge[];
};

export interface AttackGraphBuilder {
  build(input: { results: AttackResult[] }): AttackGraph | Promise<AttackGraph>;
}

export type PrioritizedFinding = AttackFinding & {
  priorityScore: number;
  rationale?: string;
};

export interface RiskPrioritizer {
  prioritize(input: {
    findings: AttackFinding[];
    context?: Record<string, unknown>;
  }): PrioritizedFinding[] | Promise<PrioritizedFinding[]>;
}

export type UnifiedRedTeamVerdictStatus = "accept" | "review" | "block";

export type UnifiedRedTeamVerdict = {
  status: UnifiedRedTeamVerdictStatus;
  headline: string;
  narrative: string;
  generatedAt: string;
  metadata?: Record<string, unknown>;
};

export interface UnifiedRedTeamVerdictEngine {
  synthesize(input: {
    results: AttackResult[];
    graph?: AttackGraph;
  }): UnifiedRedTeamVerdict | Promise<UnifiedRedTeamVerdict>;
}
