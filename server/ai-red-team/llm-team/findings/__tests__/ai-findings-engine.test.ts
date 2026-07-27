import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import { runRt10FindingsPipeline } from "../../pipeline/rt10-coordinator";
import { buildAiFindings } from "../finding-builder";
import { buildAttackPreconditions, inferModelProfile, mapAttackerCapability } from "../attack-preconditions";
import { correlateFindings } from "../finding-correlation";
import { runRt10SafeRuntimePipeline } from "../../runtime/ai-runtime-coordinator";
import { stableAiId } from "../../model/stable-id";

function baseDiscovery(): DiscoveryReport {
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
  };
}

describe("RT10 Slice 7 — AI findings engine", () => {
  it("creates findings only from validated runtime executions", async () => {
    const pipeline = await runRt10FindingsPipeline(baseDiscovery());
    expect(pipeline.findings.findings.length).toBeGreaterThan(0);
    for (const f of pipeline.findings.findings) {
      expect(f.evidence.some((e) => e.source === "runtime")).toBe(true);
      expect(f.traceability.runtimeExecutionId).toBeTruthy();
    }
  });

  it("includes invariant, graph, replay, fix context, and preconditions on every finding", async () => {
    const pipeline = await runRt10FindingsPipeline(baseDiscovery());
    for (const f of pipeline.findings.findings) {
      expect(f.traceability.invariantId).toBeTruthy();
      expect(f.traceability.graphNodeIds.length).toBeGreaterThan(0);
      expect(f.replayPlan.executable).toBe(false);
      expect(f.replayPlan.sequence.steps.length).toBeGreaterThan(0);
      expect(f.fixContext.invariantToRestoreId).toBeTruthy();
      expect(f.attackPreconditions.requiredAttackerCapability).toBeTruthy();
      expect(f.attackPreconditions.requiredGraphNodeIds.length).toBeGreaterThan(0);
    }
  });

  it("correlates duplicate findings", async () => {
    const pipeline = await runRt10SafeRuntimePipeline(baseDiscovery());
    const first = buildAiFindings({
      discovery: baseDiscovery(),
      inventory: pipeline.inventory,
      graph: pipeline.graph,
      invariants: pipeline.invariants,
      attacks: pipeline.attacks,
      specialistSummary: pipeline.specialistSummary,
      runtimeSummary: pipeline.runtimeSummary,
    });
    const dup = first.findings[0];
    if (!dup) return;
    const merged = correlateFindings([dup, { ...dup, findingId: stableAiId("dup"), findingKey: dup.findingKey + ":dup" }]);
    expect(merged.length).toBe(1);
    expect(merged[0]!.evidence.length).toBeGreaterThanOrEqual(dup.evidence.length);
  });

  it("classifies severity and confidence from runtime evidence", async () => {
    const pipeline = await runRt10FindingsPipeline(baseDiscovery());
    const severities = new Set(pipeline.findings.findings.map((f) => f.severity));
    const confidences = new Set(pipeline.findings.findings.map((f) => f.confidence));
    expect(severities.size).toBeGreaterThan(0);
    expect(confidences.has("unsupported")).toBe(false);
  });

  it("builds attack preconditions with capability and model profile", async () => {
    const pipeline = await runRt10SafeRuntimePipeline(baseDiscovery());
    const exec = pipeline.runtimeSummary.results.find((r) => r.violatedInvariantId);
    const inv = pipeline.invariants.invariants.find((i) => i.id === exec?.violatedInvariantId);
    const attack = pipeline.attacks.cases.find((c) => c.id === exec?.attackCaseId);
    if (!exec || !inv) return;
    const pre = buildAttackPreconditions({
      graph: pipeline.graph,
      invariant: inv,
      attack: attack ?? null,
      execution: exec,
    });
    expect(pre.requiredModelProfile).toBe(inferModelProfile(pipeline.graph));
    expect(pre.requiredAttackerCapability).toBe(mapAttackerCapability(attack ?? null));
    expect(pre.requiredTrustBoundaries.length).toBeGreaterThan(0);
  });

  it("generates replay plans without auto-execution", async () => {
    const pipeline = await runRt10FindingsPipeline(baseDiscovery());
    for (const f of pipeline.findings.findings) {
      expect(f.replayPlan.expectedInvariantViolationId).toBe(f.traceability.invariantId);
      expect(f.replayPlan.promptSequence.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic for the same discovery input", async () => {
    const a = await runRt10FindingsPipeline(baseDiscovery());
    const b = await runRt10FindingsPipeline(baseDiscovery());
    expect(a.findings.id).toBe(b.findings.id);
    expect(a.findings.findings.map((f) => f.findingKey).sort()).toEqual(
      b.findings.findings.map((f) => f.findingKey).sort()
    );
  });

  it("regression: Slice 6 runtime summary stable", async () => {
    const a = await runRt10SafeRuntimePipeline(baseDiscovery());
    const b = await runRt10SafeRuntimePipeline(baseDiscovery());
    expect(a.runtimeSummary.id).toBe(b.runtimeSummary.id);
    expect(a.runtimeSummary.plansCompleted).toBe(b.runtimeSummary.plansCompleted);
  });
});
