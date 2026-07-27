import type { CapabilityDescriptor } from "../capabilities/capability.types";

export const GRAPH_CONSTRUCTION_CAPABILITY: CapabilityDescriptor = {
  id: "core.graph.construction",
  name: "Graph Construction",
  version: { major: 1, minor: 0, patch: 0 },
  category: "GraphConstruction",
  description: "Builds domain execution graphs from discovery inventory.",
  supportedDomains: ["*"],
  providedContracts: ["ExecutionGraph", "GraphNode", "GraphEdge", "ExecutionPath"],
  requiredCapabilities: ["core.evidence.collection"],
  optionalCapabilities: ["core.telemetry"],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

export const GRAPH_VALIDATION_CAPABILITY: CapabilityDescriptor = {
  id: "core.graph.validation",
  name: "Graph Validation",
  version: { major: 1, minor: 0, patch: 0 },
  category: "GraphConstruction",
  description: "Validates graph integrity and statistics.",
  supportedDomains: ["*"],
  providedContracts: ["GraphValidation", "GraphStatistics"],
  requiredCapabilities: ["core.graph.construction"],
  optionalCapabilities: [],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};
