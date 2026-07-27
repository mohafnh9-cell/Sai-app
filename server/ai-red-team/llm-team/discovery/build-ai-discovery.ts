import { createHash } from "node:crypto";
import type { DiscoveryReport } from "../../discovery/types";
import type {
  AiDiscoveryEvidence,
  AiDiscoveryInventory,
  AiDiscoverySignals,
  DiscoveredAiComponent,
} from "./discovery.types";
import { inferProviderFamily, normalizeProviderLabel } from "../model/normalize-provider";
import { stableAiId } from "../model/stable-id";

function evidence(
  source: AiDiscoveryEvidence["source"],
  detail: string,
  confidence: number
): AiDiscoveryEvidence {
  return {
    id: stableAiId(`evidence:${source}:${detail}`),
    source,
    detail,
    confidence,
  };
}

function pushComponent(
  list: DiscoveredAiComponent[],
  seen: Set<string>,
  component: Omit<DiscoveredAiComponent, "id"> & { id?: string }
): void {
  const key = `${component.kind}:${component.providerFamily}:${component.label}`;
  if (seen.has(key)) return;
  seen.add(key);
  list.push({
    ...component,
    id: component.id ?? stableAiId(`component:${key}`),
  });
}

function analyzeSignals(components: DiscoveredAiComponent[]): AiDiscoverySignals {
  const families = [...new Set(components.map((c) => c.providerFamily))].sort();
  return {
    hasLlmProvider: components.some((c) => c.kind === "llm_provider"),
    hasAiSdk: components.some((c) => c.kind === "ai_sdk"),
    hasAgentFramework: components.some((c) => c.kind === "agent_framework"),
    hasMcpSurface: components.some((c) => c.kind === "mcp_server" || c.kind === "mcp_client"),
    hasVectorStore: components.some((c) => c.kind === "vector_store"),
    hasEmbeddings: components.some((c) => c.kind === "embedding_model"),
    hasMemoryHint: components.some((c) => c.kind === "memory_store"),
    hasRagHint: components.some(
      (c) => c.kind === "vector_store" || c.kind === "knowledge_base" || c.tags.includes("rag")
    ),
    hasMultiAgentHint: components.some(
      (c) => c.kind === "agent_framework" && c.tags.includes("multi_agent")
    ),
    providerFamilies: families,
  };
}

/** RT10 Slice 1 — build inventory from RT1 discovery report. */
export function buildAiDiscoveryInventory(discovery: DiscoveryReport): AiDiscoveryInventory {
  const components: DiscoveredAiComponent[] = [];
  const seen = new Set<string>();
  const summary = discovery.projectSummary.toLowerCase();

  for (const provider of discovery.aiProviders) {
    const family = inferProviderFamily(provider.name);
    pushComponent(components, seen, {
      kind: "llm_provider",
      label: provider.name,
      providerFamily: family,
      confidence: provider.confidence,
      evidence: provider.evidence.map((detail, i) =>
        evidence("discovery_report", detail, provider.confidence)
      ),
      tags: ["llm", family],
    });
  }

  for (const tech of discovery.detectedTechnologies) {
    if (tech.category !== "ai" && tech.category !== "library" && tech.category !== "integration") {
      continue;
    }
    const family = inferProviderFamily(tech.name);
    const nameLower = tech.name.toLowerCase();

    if (/vercel ai sdk|ai sdk|@ai-sdk/.test(nameLower)) {
      pushComponent(components, seen, {
        kind: "ai_sdk",
        label: tech.name,
        providerFamily: "vercel_ai_sdk",
        confidence: tech.confidence,
        evidence: tech.evidence.map((d) => evidence("technology_graph", d, tech.confidence)),
        tags: ["sdk"],
      });
      continue;
    }
    if (/langchain|langgraph/.test(nameLower)) {
      pushComponent(components, seen, {
        kind: "agent_framework",
        label: tech.name,
        providerFamily: "langchain",
        confidence: tech.confidence,
        evidence: tech.evidence.map((d) => evidence("technology_graph", d, tech.confidence)),
        tags: ["agent", "orchestration"],
      });
      continue;
    }
    if (/llamaindex|llama-index/.test(nameLower)) {
      pushComponent(components, seen, {
        kind: "agent_framework",
        label: tech.name,
        providerFamily: "llamaindex",
        confidence: tech.confidence,
        evidence: tech.evidence.map((d) => evidence("technology_graph", d, tech.confidence)),
        tags: ["agent", "rag"],
      });
      continue;
    }
    if (/crewai|autogen|ag2/.test(nameLower)) {
      pushComponent(components, seen, {
        kind: "agent_framework",
        label: tech.name,
        providerFamily: /crew/i.test(nameLower) ? "crewai" : "autogen",
        confidence: tech.confidence,
        evidence: tech.evidence.map((d) => evidence("technology_graph", d, tech.confidence)),
        tags: ["agent", "multi_agent"],
      });
      continue;
    }
    if (/openrouter/.test(nameLower)) {
      pushComponent(components, seen, {
        kind: "router",
        label: tech.name,
        providerFamily: "openrouter",
        confidence: tech.confidence,
        evidence: tech.evidence.map((d) => evidence("technology_graph", d, tech.confidence)),
        tags: ["router"],
      });
      continue;
    }
    if (/mcp|model context protocol/.test(nameLower)) {
      pushComponent(components, seen, {
        kind: "mcp_server",
        label: tech.name,
        providerFamily: "mcp",
        confidence: tech.confidence,
        evidence: tech.evidence.map((d) => evidence("technology_graph", d, tech.confidence)),
        tags: ["mcp"],
      });
    }
    if (/pinecone|weaviate|qdrant|chroma|pgvector|vector/.test(nameLower)) {
      pushComponent(components, seen, {
        kind: "vector_store",
        label: tech.name,
        providerFamily: family,
        confidence: tech.confidence,
        evidence: tech.evidence.map((d) => evidence("technology_graph", d, tech.confidence)),
        tags: ["rag", "vector"],
      });
    }
    if (/embed/.test(nameLower)) {
      pushComponent(components, seen, {
        kind: "embedding_model",
        label: tech.name,
        providerFamily: family,
        confidence: tech.confidence,
        evidence: tech.evidence.map((d) => evidence("technology_graph", d, tech.confidence)),
        tags: ["embedding"],
      });
    }
  }

  for (const surface of discovery.potentialAttackSurface) {
    if (surface.area === "llm") {
      pushComponent(components, seen, {
        kind: "llm_provider",
        label: surface.label,
        providerFamily: inferProviderFamily(surface.label),
        confidence: surface.confidence,
        evidence: [evidence("attack_surface", surface.rationale, surface.confidence)],
        tags: ["llm", "surface"],
      });
    }
    if (surface.area === "mcp_servers") {
      pushComponent(components, seen, {
        kind: "mcp_server",
        label: surface.label,
        providerFamily: "mcp",
        confidence: surface.confidence,
        evidence: [evidence("attack_surface", surface.rationale, surface.confidence)],
        tags: ["mcp", "surface"],
      });
    }
  }

  if (/\brag\b|retrieval|vector search|knowledge base/i.test(summary)) {
    pushComponent(components, seen, {
      kind: "knowledge_base",
      label: "Knowledge base (summary hint)",
      providerFamily: "generic",
      confidence: 0.65,
      evidence: [evidence("project_summary", discovery.projectSummary.slice(0, 200), 0.65)],
      tags: ["rag", "knowledge"],
    });
  }
  if (/\bmemory\b|chat history|conversation store/i.test(summary)) {
    pushComponent(components, seen, {
      kind: "memory_store",
      label: "Conversation memory (summary hint)",
      providerFamily: "generic",
      confidence: 0.62,
      evidence: [evidence("project_summary", "Memory or chat persistence referenced", 0.62)],
      tags: ["memory"],
    });
  }

  components.sort((a, b) =>
    a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind.localeCompare(b.kind)
  );

  return {
    id: stableAiId(`inventory:${discovery.projectId}:${discovery.commitSha}`),
    generatedAt: discovery.generatedAt,
    projectId: discovery.projectId,
    organizationId: discovery.organizationId,
    signals: analyzeSignals(components),
    components,
  };
}

export { normalizeProviderLabel, inferProviderFamily };
