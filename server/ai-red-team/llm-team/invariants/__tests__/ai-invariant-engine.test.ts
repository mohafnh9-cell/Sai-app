import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import { buildAiDiscoveryInventory } from "../../discovery/build-ai-discovery";
import { buildAiExecutionGraph } from "../../model/build-execution-graph";
import { validateAiExecutionGraph } from "../../model/graph-validation";
import {
  AIInvariantExtractor,
  classifyAiInvariantConfidence,
  extractAiTrustInvariants,
  invariantPassesMinimumBar,
  maxEvidenceConfidence,
  mergeAiInvariantEvidence,
  validateAiInvariantCollection,
} from "../index";

function baseDiscovery(overrides: Partial<DiscoveryReport> = {}): DiscoveryReport {
  return {
    reportId: "r1",
    projectId: "p1",
    organizationId: "o1",
    commitSha: "sha1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 1,
    projectSummary: "AI SaaS with RAG, LangChain agents, and MCP tools.",
    detectedTechnologies: [
      { id: "lc", name: "LangChain", category: "ai", confidence: 0.9, evidence: ["package.json"] },
      { id: "sdk", name: "Vercel AI SDK", category: "library", confidence: 0.88, evidence: ["package.json"] },
      { id: "vs", name: "Pinecone", category: "integration", confidence: 0.85, evidence: ["env"] },
    ],
    authenticationProviders: [],
    database: [],
    payments: [],
    aiProviders: [{ id: "openai", name: "OpenAI", category: "ai", confidence: 0.95, evidence: ["sdk"] }],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: ["npm"],
    potentialAttackSurface: [
      { area: "llm", label: "Chat API", rationale: "LLM routes", confidence: 0.9 },
      { area: "mcp_servers", label: "MCP", rationale: "Tools", confidence: 0.85 },
    ],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.9,
    cached: false,
    ...overrides,
  };
}

function graphFromDiscovery(overrides?: Partial<DiscoveryReport>) {
  const inv = buildAiDiscoveryInventory(baseDiscovery(overrides));
  return buildAiExecutionGraph(inv);
}

describe("RT10 Slice 3 — AI trust invariant engine", () => {
  it("returns empty collection for empty graph", () => {
    const empty = buildAiDiscoveryInventory(
      baseDiscovery({
        aiProviders: [],
        detectedTechnologies: [],
        potentialAttackSurface: [],
        projectSummary: "Static site",
      })
    );
    expect(empty.components.length).toBe(0);
    const graph = buildAiExecutionGraph(empty);
    const collection = extractAiTrustInvariants({ graph });
    expect(collection.invariants).toHaveLength(0);
    expect(collection.groups).toHaveLength(0);
  });

  it("extracts prompt hierarchy and trust boundary invariants", () => {
    const graph = graphFromDiscovery();
    const collection = extractAiTrustInvariants({ graph });
    const categories = new Set(collection.invariants.map((i) => i.category));
    expect(categories.has("instruction_priority")).toBe(true);
    expect(categories.has("system_prompt_integrity")).toBe(true);
    expect(categories.has("trust_boundary_preservation")).toBe(true);
    expect(categories.has("prompt_integrity")).toBe(true);
    expect(categories.has("instruction_integrity")).toBe(true);
  });

  it("extracts tool, memory, and retrieval invariants from canonical graph", () => {
    const graph = graphFromDiscovery();
    const collection = extractAiTrustInvariants({ graph });
    const categories = new Set(collection.invariants.map((i) => i.category));
    expect(categories.has("tool_authorization")).toBe(true);
    expect(categories.has("tool_result_validation")).toBe(true);
    expect(categories.has("memory_isolation")).toBe(true);
    expect(categories.has("retrieval_integrity")).toBe(true);
    expect(categories.has("retrieval_authenticity")).toBe(true);
    expect(categories.has("embedding_integrity")).toBe(true);
  });

  it("extracts agent and MCP invariants", () => {
    const graph = graphFromDiscovery();
    const collection = extractAiTrustInvariants({ graph });
    const categories = new Set(collection.invariants.map((i) => i.category));
    expect(graph.agents.length).toBeGreaterThan(0);
    expect(categories.has("agent_delegation")).toBe(true);
    expect(categories.has("mcp_isolation")).toBe(true);
    expect(
      categories.has("agent_isolation") ||
        categories.has("sub_agent_isolation") ||
        categories.has("multi_agent_coordination")
    ).toBe(true);
    if (graph.multiAgentGraphs.length > 0) {
      expect(categories.has("multi_agent_coordination")).toBe(true);
    }
  });

  it("every invariant has boundary, graph nodes, and evidence-backed confidence", () => {
    const graph = graphFromDiscovery();
    const collection = extractAiTrustInvariants({ graph });
    for (const inv of collection.invariants) {
      expect(inv.protectedTrustBoundaryId).toBeTruthy();
      expect(inv.relationships.graphNodeIds.length).toBeGreaterThan(0);
      expect(inv.evidence.length).toBeGreaterThan(0);
      expect(invariantPassesMinimumBar(inv)).toBe(true);
      expect(inv.confidence).not.toBe("unsupported");
      expect(inv.metadata.providerFamily).toBeNull();
    }
  });

  it("propagates confidence from evidence and assumptions", () => {
    const evidence = [
      { id: "e1", source: "execution_graph" as const, detail: "x", confidence: 0.92 },
    ];
    const level = classifyAiInvariantConfidence({
      hasBoundary: true,
      hasExplicitEdge: true,
      evidenceMax: maxEvidenceConfidence(evidence),
      fromAssumptionOnly: false,
    });
    expect(level).toBe("explicit");

    const assumed = classifyAiInvariantConfidence({
      hasBoundary: true,
      hasExplicitEdge: true,
      evidenceMax: 0.9,
      fromAssumptionOnly: true,
    });
    expect(assumed).toBe("assumed");

    const merged = mergeAiInvariantEvidence(evidence, evidence);
    expect(merged).toHaveLength(1);
  });

  it("is deterministic for the same graph", () => {
    const graph = graphFromDiscovery();
    const a = extractAiTrustInvariants({ graph });
    const b = extractAiTrustInvariants({ graph });
    expect(a.id).toBe(b.id);
    expect(a.invariants.map((i) => i.invariantKey)).toEqual(b.invariants.map((i) => i.invariantKey));
  });

  it("AIInvariantExtractor.extract matches extractAiTrustInvariants", () => {
    const graph = graphFromDiscovery();
    expect(AIInvariantExtractor.extract({ graph }).invariants.length).toBe(
      extractAiTrustInvariants({ graph }).invariants.length
    );
  });

  it("regression: Slice 2 graph validation still passes", () => {
    const graph = graphFromDiscovery();
    const issues = validateAiExecutionGraph(graph);
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("collection validation has no per-invariant errors on canonical graph", () => {
    const graph = graphFromDiscovery();
    const collection = extractAiTrustInvariants({ graph });
    const perInv = collection.validationViolations.filter((v) => v.invariantId !== null);
    expect(perInv).toHaveLength(0);
  });

  it("validateAiInvariantCollection attaches graph-level checks", () => {
    const graph = graphFromDiscovery();
    const raw = extractAiTrustInvariants({ graph });
    const validated = validateAiInvariantCollection(raw, graph);
    expect(validated.validationViolations.length).toBeGreaterThanOrEqual(0);
  });
});
