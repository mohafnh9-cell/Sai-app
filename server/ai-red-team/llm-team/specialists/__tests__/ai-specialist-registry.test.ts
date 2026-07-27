import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import { buildAiDiscoveryInventory } from "../../discovery/build-ai-discovery";
import { buildAiExecutionGraph } from "../../model/build-execution-graph";
import { extractAiTrustInvariants } from "../../invariants/invariant-extractor";
import { generateAiAttackCases } from "../../attacks/attack-generator";
import {
  createAiSpecialistRegistry,
  createDefaultAiSpecialistRegistry,
} from "../../registry";
import { specialistContextFromGraph } from "../specialist-context";
import { runAiSecuritySpecialists } from "../specialist-runner";
import { PromptSecuritySpecialist } from "../default-specialist-pack";
import { runRt10SpecialistPlanningPipeline } from "../../pipeline/rt10-coordinator";

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

function specialistContextFromDiscovery(overrides?: Partial<DiscoveryReport>) {
  const discovery = baseDiscovery(overrides);
  const inventory = buildAiDiscoveryInventory(discovery);
  const graph = buildAiExecutionGraph(inventory);
  const invariants = extractAiTrustInvariants({ graph });
  const attacks = generateAiAttackCases({ graph, invariants }).collection;
  return specialistContextFromGraph({ discovery, inventory, graph, invariants, attacks });
}

describe("RT10 Slice 5 — AI security specialist registry", () => {
  it("orders specialists by priority", () => {
    const registry = createDefaultAiSpecialistRegistry();
    const ids = registry.listAll().map((s) => s.id);
    expect(ids[0]).toBe("ai.prompt_security");
    expect(ids[ids.length - 1]).toBe("ai.guardrail");
  });

  it("rejects duplicate specialist registration", () => {
    const registry = createAiSpecialistRegistry([new PromptSecuritySpecialist()]);
    expect(() => registry.register(new PromptSecuritySpecialist())).toThrow(/already registered/);
  });

  it("selects eligible specialists from graph-backed signals", () => {
    const context = specialistContextFromDiscovery();
    const registry = createDefaultAiSpecialistRegistry();
    const eligible = registry.selectEligible(context);
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.some((s) => s.id === "ai.prompt_security")).toBe(true);
    expect(eligible.some((s) => s.id === "ai.tool_security")).toBe(true);
  });

  it("skips all specialists when graph is empty despite technologies in discovery", async () => {
    const context = specialistContextFromDiscovery({
      aiProviders: [],
      detectedTechnologies: [],
      potentialAttackSurface: [],
      projectSummary: "Static site",
    });
    expect(context.graph.nodes.length).toBe(0);
    const summary = await awaitRun(context);
    expect(summary.specialistsCompleted).toBe(0);
    expect(summary.specialistsSkipped).toBe(8);
  });

  it("plans reference existing attack hypotheses and invariants", async () => {
    const context = specialistContextFromDiscovery();
    const specialist = new PromptSecuritySpecialist();
    const eligibility = specialist.canRun(context);
    expect(eligibility.eligible).toBe(true);
    const plan = await specialist.plan(context);
    const attackIds = new Set(context.attacks.cases.map((c) => c.id));
    const invariantIds = new Set(context.invariants.invariants.map((i) => i.id));
    for (const id of plan.targetAttackCaseIds) {
      expect(attackIds.has(id)).toBe(true);
    }
    for (const id of plan.targetInvariantIds) {
      expect(invariantIds.has(id)).toBe(true);
    }
    expect(plan.validationSteps.length).toBeGreaterThan(0);
    expect(plan.executionClassification).toBe("static_plan_only");
  });

  it("isolates specialist failures without stopping the registry run", async () => {
    const context = specialistContextFromDiscovery();
    const registry = createDefaultAiSpecialistRegistry();
    const summary = await runAiSecuritySpecialists({
      registry,
      context,
      options: { forceFailSpecialistIds: ["ai.tool_security"] },
    });
    expect(summary.specialistsFailed).toBe(1);
    expect(summary.specialistsCompleted + summary.specialistsPartial).toBeGreaterThan(0);
    expect(summary.results.length).toBe(8);
  });

  it("enforces registry budget and blocks remaining specialists", async () => {
    const context = specialistContextFromDiscovery();
    const registry = createDefaultAiSpecialistRegistry();
    const summary = await runAiSecuritySpecialists({
      registry,
      context,
      options: { maxRegistryBudgetMs: 0 },
    });
    expect(summary.results.every((r) => r.status === "blocked")).toBe(true);
  });

  it("emits observations that are not findings", async () => {
    const context = specialistContextFromDiscovery();
    const summary = await awaitRun(context);
    expect(summary.observationCount).toBeGreaterThan(0);
    for (const result of summary.results) {
      for (const obs of result.observations) {
        expect(obs.status).not.toBe("finding" as never);
        expect(result.metadata.providerFamily).toBeNull();
      }
    }
  });

  it("runs coordinator pipeline through specialist planning", async () => {
    const result = await runRt10SpecialistPlanningPipeline(baseDiscovery());
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.attacks.cases.length).toBeGreaterThan(0);
    expect(result.specialistSummary.specialistsTotal).toBe(8);
    expect(result.specialistSummary.explainability.length).toBe(8);
  });

  it("regression: Slice 4 attack generation unchanged", () => {
    const context = specialistContextFromDiscovery();
    const again = specialistContextFromDiscovery();
    expect(context.attacks.cases.map((c) => c.attackKey)).toEqual(
      again.attacks.cases.map((c) => c.attackKey)
    );
  });
});

async function awaitRun(context: ReturnType<typeof specialistContextFromDiscovery>) {
  const registry = createDefaultAiSpecialistRegistry();
  return runAiSecuritySpecialists({ registry, context });
}
