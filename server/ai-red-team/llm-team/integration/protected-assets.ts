import type { AIExecutionGraph } from "../model/execution-graph.types";
import type { AIFinding } from "../findings/finding.types";

/** Canonical protected asset labels (RT10 Slice 8). */
export const PROTECTED_ASSET_CATALOG = [
  "System Prompt",
  "Developer Prompt",
  "User Prompt",
  "Conversation History",
  "Persistent Memory",
  "Temporary Memory",
  "Retrieved Context",
  "Knowledge Base",
  "Vector Store",
  "Embeddings",
  "Tool Credentials",
  "Function Permissions",
  "External APIs",
  "MCP Servers",
  "MCP Clients",
  "Agent Identity",
  "Sub-Agent Identity",
  "Guardrails",
  "Moderation Policies",
  "Secrets",
  "API Keys",
  "Organization Data",
  "Customer Data",
  "Tenant Isolation",
  "Business Configuration",
  "Fine-Tuned Models",
  "Prompt Templates",
  "Custom Policies",
] as const;

export type ProtectedAssetKind = (typeof PROTECTED_ASSET_CATALOG)[number];

const NODE_KIND_TO_ASSET: Partial<
  Record<import("../model/execution-graph.types").AIExecutionNodeKind, ProtectedAssetKind[]>
> = {
  system_prompt: ["System Prompt", "Prompt Templates"],
  developer_prompt: ["Developer Prompt", "Prompt Templates"],
  user_prompt: ["User Prompt"],
  conversation: ["Conversation History"],
  memory: ["Persistent Memory", "Temporary Memory"],
  retrieved_context: ["Retrieved Context"],
  knowledge_base: ["Knowledge Base"],
  vector_store: ["Vector Store"],
  embedding: ["Embeddings"],
  tool: ["Tool Credentials", "Function Permissions"],
  function_call: ["Function Permissions"],
  external_api: ["External APIs", "API Keys"],
  mcp_server: ["MCP Servers"],
  mcp_client: ["MCP Clients"],
  agent: ["Agent Identity"],
  sub_agent: ["Sub-Agent Identity"],
  guardrail: ["Guardrails", "Custom Policies"],
  moderation: ["Moderation Policies"],
  llm: ["Fine-Tuned Models"],
};

export type ProtectedAssetRecord = {
  asset: ProtectedAssetKind;
  graphNodeIds: string[];
  findingIds: string[];
};

export type ProtectedAssetSummary = {
  totalAssets: number;
  assets: ProtectedAssetRecord[];
};

export function summarizeProtectedAssets(input: {
  graph: AIExecutionGraph;
  findings: AIFinding[];
}): ProtectedAssetSummary {
  const byAsset = new Map<ProtectedAssetKind, { nodes: Set<string>; findings: Set<string> }>();

  for (const node of input.graph.nodes) {
    const labels = NODE_KIND_TO_ASSET[node.kind] ?? [];
    for (const asset of labels) {
      const entry = byAsset.get(asset) ?? { nodes: new Set<string>(), findings: new Set<string>() };
      entry.nodes.add(node.id);
      byAsset.set(asset, entry);
    }
  }

  for (const finding of input.findings) {
    for (const raw of finding.impact.affectedAssets) {
      const match = PROTECTED_ASSET_CATALOG.find(
        (a) => a.toLowerCase() === raw.toLowerCase() || raw.toLowerCase().includes(a.toLowerCase())
      );
      if (!match) continue;
      const entry = byAsset.get(match) ?? { nodes: new Set<string>(), findings: new Set<string>() };
      entry.findings.add(finding.findingId);
      for (const nodeId of finding.traceability.graphNodeIds) entry.nodes.add(nodeId);
      byAsset.set(match, entry);
    }
  }

  const assets: ProtectedAssetRecord[] = [...byAsset.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([asset, refs]) => ({
      asset,
      graphNodeIds: [...refs.nodes].sort(),
      findingIds: [...refs.findings].sort(),
    }));

  return { totalAssets: assets.length, assets };
}
