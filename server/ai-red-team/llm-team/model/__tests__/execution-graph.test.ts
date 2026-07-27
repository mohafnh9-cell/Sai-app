import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import { buildAiDiscoveryInventory } from "../../discovery/build-ai-discovery";
import { buildAiExecutionGraph } from "../build-execution-graph";
import { inferProviderFamily, normalizeProviderLabel } from "../normalize-provider";
import { validateAiExecutionGraph } from "../graph-validation";
import { stableAiId } from "../stable-id";

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

describe("RT10 Slice 2 — AI execution graph", () => {
  it("creates deterministic graph from discovery inventory", () => {
    const inv = buildAiDiscoveryInventory(baseDiscovery());
    const g1 = buildAiExecutionGraph(inv);
    const g2 = buildAiExecutionGraph(inv);
    expect(g1.id).toBe(g2.id);
    expect(g1.nodes.length).toBe(g2.nodes.length);
    expect(g1.edges.length).toBe(g2.edges.length);
    expect(g1.nodes.map((n) => n.kind).sort()).toEqual(g2.nodes.map((n) => n.kind).sort());
  });

  it("models canonical conversation and prompt chain", () => {
    const graph = buildAiExecutionGraph(buildAiDiscoveryInventory(baseDiscovery()));
    expect(graph.conversations.length).toBe(1);
    expect(graph.prompts.length).toBe(3);
    const kinds = graph.nodes.map((n) => n.kind);
    expect(kinds).toContain("user");
    expect(kinds).toContain("user_prompt");
    expect(kinds).toContain("system_prompt");
    expect(kinds).toContain("llm");
    expect(kinds).toContain("response");
    expect(kinds).toContain("memory");
  });

  it("creates relationships uses invokes retrieves stores", () => {
    const graph = buildAiExecutionGraph(buildAiDiscoveryInventory(baseDiscovery()));
    const kinds = new Set(graph.edges.map((e) => e.kind));
    expect(kinds.has("executes")).toBe(true);
    expect(kinds.has("invokes")).toBe(true);
    expect(kinds.has("stores")).toBe(true);
    expect(kinds.has("retrieves")).toBe(true);
  });

  it("models boundaries trust tool memory retrieval", () => {
    const graph = buildAiExecutionGraph(buildAiDiscoveryInventory(baseDiscovery()));
    const boundaryKinds = graph.boundaries.map((b) => b.kind);
    expect(boundaryKinds).toContain("trust");
    expect(boundaryKinds).toContain("tool");
    expect(boundaryKinds).toContain("memory");
    expect(boundaryKinds).toContain("retrieval");
  });

  it("models agents tools memory MCP and RAG artifacts", () => {
    const graph = buildAiExecutionGraph(buildAiDiscoveryInventory(baseDiscovery()));
    expect(graph.agents.length).toBeGreaterThan(0);
    expect(graph.tools.length).toBeGreaterThan(0);
    expect(graph.vectorStores.length).toBeGreaterThan(0);
    expect(graph.retrievals.length).toBeGreaterThan(0);
    expect(graph.nodes.some((n) => n.kind === "mcp_server")).toBe(true);
  });

  it("normalizes providers", () => {
    expect(inferProviderFamily("OpenAI GPT-4")).toBe("openai");
    expect(inferProviderFamily("Anthropic Claude 3")).toBe("anthropic");
    expect(inferProviderFamily("Google Gemini Pro")).toBe("google_gemini");
    expect(inferProviderFamily("Groq Cloud")).toBe("groq");
    expect(inferProviderFamily("LangChain")).toBe("langchain");
    expect(normalizeProviderLabel("vercel_ai_sdk")).toBe("Vercel AI SDK");
  });

  it("validates graph without duplicate nodes for stable inventory", () => {
    const graph = buildAiExecutionGraph(buildAiDiscoveryInventory(baseDiscovery()));
    const issues = validateAiExecutionGraph(graph);
    expect(issues.filter((i) => i.code === "duplicate_node")).toHaveLength(0);
    expect(issues.filter((i) => i.code === "broken_relationship")).toHaveLength(0);
  });

  it("defers empty graph when no AI signals", () => {
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
    expect(graph.nodes.length).toBe(0);
    expect(graph.paths.length).toBe(0);
  });

  it("stable ids derived from semantic keys", () => {
    expect(stableAiId("a")).toBe(stableAiId("a"));
    expect(stableAiId("a")).not.toBe(stableAiId("b"));
  });

  it("regression: graph schema version is 1", () => {
    const graph = buildAiExecutionGraph(buildAiDiscoveryInventory(baseDiscovery()));
    expect(graph.schemaVersion).toBe(1);
    expect(graph.responsePipelines.length).toBe(1);
    expect(graph.outputs.length).toBe(1);
  });
});
