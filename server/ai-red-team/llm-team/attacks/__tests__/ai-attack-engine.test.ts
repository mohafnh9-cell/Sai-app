import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import { buildAiDiscoveryInventory } from "../../discovery/build-ai-discovery";
import { buildAiExecutionGraph } from "../../model/build-execution-graph";
import { extractAiTrustInvariants } from "../../invariants/invariant-extractor";
import {
  AIAttackGenerator,
  attackConfidenceFromInvariant,
  generateAiAttackCases,
  validateAttackCase,
  validateAttackCollection,
} from "../index";
import type { AIAttackCase } from "../attack.types";
import { stableAiId } from "../../model/stable-id";

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

function pipeline() {
  const graph = buildAiExecutionGraph(buildAiDiscoveryInventory(baseDiscovery()));
  const invariants = extractAiTrustInvariants({ graph });
  const attacks = generateAiAttackCases({ graph, invariants });
  return { graph, invariants, attacks };
}

describe("RT10 Slice 4 — AI attack generation engine", () => {
  it("generates attacks from invariants deterministically", () => {
    const a = pipeline();
    const b = pipeline();
    expect(a.attacks.collection.id).toBe(b.attacks.collection.id);
    expect(a.attacks.collection.cases.map((c) => c.attackKey)).toEqual(
      b.attacks.collection.cases.map((c) => c.attackKey)
    );
    expect(a.attacks.plannedInvariantCount).toBeGreaterThan(0);
    expect(a.attacks.acceptedCount).toBeGreaterThan(0);
  });

  it("generates prompt injection from prompt integrity invariant", () => {
    const { attacks } = pipeline();
    const cats = new Set(attacks.collection.cases.map((c) => c.category));
    expect(cats.has("prompt_injection")).toBe(true);
    expect(cats.has("instruction_override")).toBe(true);
  });

  it("generates indirect prompt injection", () => {
    const { attacks } = pipeline();
    expect(attacks.collection.cases.some((c) => c.category === "indirect_prompt_injection")).toBe(true);
  });

  it("generates tool abuse attacks", () => {
    const { attacks } = pipeline();
    const toolCats = attacks.collection.cases.filter((c) =>
      ["tool_abuse", "unauthorized_tool_invocation", "parameter_injection", "tool_result_injection"].includes(
        c.category
      )
    );
    expect(toolCats.length).toBeGreaterThan(0);
    for (const c of toolCats) {
      expect(c.targetInvariantId).toBeTruthy();
      expect(c.sequence.steps.length).toBeGreaterThan(2);
    }
  });

  it("generates memory poisoning and RAG poisoning", () => {
    const { attacks } = pipeline();
    expect(attacks.collection.cases.some((c) => c.category === "memory_poisoning")).toBe(true);
    expect(attacks.collection.cases.some((c) => c.category === "rag_poisoning")).toBe(true);
  });

  it("generates MCP and agent attacks", () => {
    const { attacks } = pipeline();
    expect(attacks.collection.cases.some((c) => c.category === "mcp_tool_abuse")).toBe(true);
    expect(
      attacks.collection.cases.some((c) =>
        ["agent_delegation_abuse", "sub_agent_manipulation", "agent_impersonation"].includes(c.category)
      )
    ).toBe(true);
  });

  it("every attack references invariant, boundary, and graph nodes", () => {
    const { graph, invariants, attacks } = pipeline();
    for (const c of attacks.collection.cases) {
      expect(invariants.invariants.some((i) => i.id === c.targetInvariantId)).toBe(true);
      expect(graph.boundaries.some((b) => b.id === c.targetTrustBoundaryId)).toBe(true);
      expect(c.sequence.graphNodeIds.length).toBeGreaterThan(0);
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.confidence).not.toBe("unsupported");
      expect(c.metadata.providerFamily).toBeNull();
      expect(c.assumptions.length).toBeGreaterThan(0);
    }
  });

  it("propagates confidence from invariant evidence", () => {
    expect(attackConfidenceFromInvariant("explicit", 0.92)).toBe("confirmed");
    expect(attackConfidenceFromInvariant("assumed", 0.7)).toBe("possible");
  });

  it("rejects impossible topology attacks", () => {
    const { graph, invariants } = pipeline();
    const bogus: AIAttackCase = {
      id: stableAiId("attack:bogus"),
      attackKey: "bogus:attack:tool",
      title: "Impossible tool attack",
      description: "Should reject",
      category: "tool_abuse",
      targetInvariantId: invariants.invariants[0]!.id,
      targetInvariantKey: invariants.invariants[0]!.invariantKey,
      targetTrustBoundaryId: invariants.invariants[0]!.protectedTrustBoundaryId,
      targetComponentNodeIds: [],
      manipulatedComponentKind: "tool",
      executionGraphId: graph.id,
      sequence: {
        id: stableAiId("seq:bogus"),
        executionPathId: "nonexistent-path",
        graphNodeIds: ["missing-node-id"],
        graphEdgeIds: [],
        steps: [],
        invariantViolationSummary: "x",
        expectedConsequence: "y",
      },
      attackerCapability: "anonymous_user",
      expectedImpact: "z",
      confidence: "likely",
      evidence: [
        { id: stableAiId("ev:1"), source: "invariant", detail: "test", confidence: 0.8, refId: null },
      ],
      assumptions: [
        {
          id: stableAiId("asm:1"),
          statement: "test",
          required: true,
          capability: "anonymous_user",
        },
      ],
      suggestedRuntimeStrategy: "mock",
      potentialMitigationCategory: "mitigate",
      metadata: {
        providerFamily: null,
        strategyId: "test",
        specialistPackId: null,
        tags: [],
        generationPass: "test",
      },
    };

    const issues = validateAttackCase(bogus, graph, invariants);
    expect(issues.some((i) => i.code === "impossible_topology")).toBe(true);
    expect(issues.some((i) => i.code === "impossible_path")).toBe(true);

    const collection = validateAttackCollection(
      {
        id: stableAiId("col:bogus"),
        executionGraphId: graph.id,
        invariantCollectionId: invariants.id,
        cases: [bogus],
        validationIssues: [],
        generatedAt: new Date().toISOString(),
      },
      graph,
      invariants
    );
    expect(collection.cases).toHaveLength(0);
  });

  it("AIAttackGenerator.generate matches generateAiAttackCases", () => {
    const { graph, invariants } = pipeline();
    expect(
      AIAttackGenerator.generate({ graph, invariants }).acceptedCount
    ).toBe(generateAiAttackCases({ graph, invariants }).acceptedCount);
  });

  it("regression: Slice 3 invariant extraction unchanged", () => {
    const graph = buildAiExecutionGraph(buildAiDiscoveryInventory(baseDiscovery()));
    const inv = extractAiTrustInvariants({ graph });
    expect(inv.invariants.length).toBeGreaterThan(20);
    expect(inv.validationViolations.filter((v) => v.invariantId !== null)).toHaveLength(0);
  });
});
