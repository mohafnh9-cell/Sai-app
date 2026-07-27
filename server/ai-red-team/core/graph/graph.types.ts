import type { CoreUniqueId } from "../contracts/identifiers";

/** Domain-agnostic execution graph — node semantics are opaque to RT-Core. */
export type CoreGraphNode<TKind extends string = string> = {
  id: CoreUniqueId;
  kind: TKind;
  label: string;
  confidence: number;
  metadata?: Record<string, unknown>;
};

export type CoreGraphEdge<TKind extends string = string> = {
  id: CoreUniqueId;
  fromNodeId: CoreUniqueId;
  toNodeId: CoreUniqueId;
  kind: TKind;
  label: string;
  metadata?: Record<string, unknown>;
};

export type CoreExecutionPath = {
  id: CoreUniqueId;
  nodeIds: CoreUniqueId[];
  label: string;
  purpose: string;
};

export type CoreGraphMetadata = {
  id: CoreUniqueId;
  generatedAt: string;
  version: string;
  labels: string[];
};

export type CoreExecutionGraph<
  TNodeKind extends string = string,
  TEdgeKind extends string = string,
> = {
  metadata: CoreGraphMetadata;
  nodes: CoreGraphNode<TNodeKind>[];
  edges: CoreGraphEdge<TEdgeKind>[];
  paths: CoreExecutionPath[];
};

export type CoreGraphStatistics = {
  nodeCount: number;
  edgeCount: number;
  pathCount: number;
  averageNodeConfidence: number;
};

export type CoreGraphValidationIssue = {
  code: string;
  message: string;
  nodeId?: CoreUniqueId;
  edgeId?: CoreUniqueId;
};
