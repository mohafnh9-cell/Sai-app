import type { DiscoveryReport } from "../../discovery/types";
import type { PipelineContext, PipelineStageHandlers } from "../../core/declarative/pipeline/pipeline.types";
import { buildAiDiscoveryInventory } from "../discovery/build-ai-discovery";
import { buildAiExecutionGraph } from "../model/build-execution-graph";
import { extractAiTrustInvariants } from "../invariants/invariant-extractor";
import { generateAiAttackCases } from "../attacks/attack-generator";
import { createDefaultAiSpecialistRegistry } from "../registry/register-default-specialists";
import { specialistContextFromGraph } from "../specialists/specialist-context";
import { runAiSecuritySpecialists } from "../specialists/specialist-runner";
import { stableAiId } from "../model/stable-id";
import {
  DEFAULT_AI_RUNTIME_BUDGET,
  DEFAULT_AI_RUNTIME_LIMITS,
  DEFAULT_AI_RUNTIME_PROFILE,
} from "../runtime/runtime.config";
import type { AIRuntimeContext } from "../runtime/runtime.types";
import { runAiSafeRuntime } from "../runtime/ai-runtime";
import { buildAiFindings } from "../findings/finding-builder";
import { computeStepCoverage } from "../../core/coverage/coverage.types";

function discoveryReport(ctx: PipelineContext): DiscoveryReport {
  const report = ctx.artifacts.discoveryReport as DiscoveryReport | undefined;
  if (!report) throw new Error("discoveryReport missing from pipeline context");
  return report;
}

export function createRt10StageHandlers(): PipelineStageHandlers {
  return {
    discovery: async (ctx) => {
      const inventory = buildAiDiscoveryInventory(discoveryReport(ctx));
      if (inventory.components.length === 0) {
        return { status: "skipped", skipReason: "No AI components discovered.", outputs: { inventory } };
      }
      return { status: "completed", outputs: { inventory, "artifact:discovery": inventory } };
    },
    graph: async (ctx) => {
      const inventory = ctx.artifacts.inventory;
      if (!inventory) return { status: "skipped", skipReason: "Missing discovery inventory." };
      const graph = buildAiExecutionGraph(inventory as never);
      return { status: "completed", outputs: { graph, "artifact:graph": graph } };
    },
    trust_boundaries: async (ctx) => {
      const graph = ctx.artifacts.graph as { boundaries: unknown[] } | undefined;
      if (!graph) return { status: "skipped", skipReason: "Missing graph." };
      return {
        status: "completed",
        outputs: {
          trustBoundaryCount: graph.boundaries.length,
          "artifact:trust_boundaries": graph.boundaries,
        },
      };
    },
    invariants: async (ctx) => {
      const graph = ctx.artifacts.graph;
      if (!graph) return { status: "skipped", skipReason: "Missing graph." };
      const invariants = extractAiTrustInvariants({ graph: graph as never });
      return { status: "completed", outputs: { invariants, "artifact:invariants": invariants } };
    },
    attack_generation: async (ctx) => {
      const graph = ctx.artifacts.graph;
      const invariants = ctx.artifacts.invariants;
      if (!graph || !invariants) return { status: "skipped", skipReason: "Missing graph or invariants." };
      const attacks = generateAiAttackCases({
        graph: graph as never,
        invariants: invariants as never,
      }).collection;
      return { status: "completed", outputs: { attacks, "artifact:attack_generation": attacks } };
    },
    specialist_selection: async (ctx) => {
      const graph = ctx.artifacts.graph;
      const invariants = ctx.artifacts.invariants;
      const attacks = ctx.artifacts.attacks;
      const inventory = ctx.artifacts.inventory;
      if (!graph || !invariants || !attacks || !inventory) {
        return { status: "skipped", skipReason: "Missing prerequisites for specialists." };
      }
      const discovery = discoveryReport(ctx);
      const context = specialistContextFromGraph({
        discovery,
        inventory: inventory as never,
        graph: graph as never,
        invariants: invariants as never,
        attacks: attacks as never,
      });
      const registry = createDefaultAiSpecialistRegistry();
      const specialistSummary = await runAiSecuritySpecialists({
        registry,
        context,
        signal: ctx.signal,
      });
      return {
        status: "completed",
        outputs: { specialistSummary, specialistContext: context, "artifact:specialist_selection": specialistSummary },
      };
    },
    runtime_selection: async (ctx) => {
      return {
        status: "completed",
        outputs: {
          runtimeProfile: DEFAULT_AI_RUNTIME_PROFILE,
          "artifact:runtime_selection": DEFAULT_AI_RUNTIME_PROFILE,
        },
      };
    },
    execution: async (ctx) => {
      const graph = ctx.artifacts.graph;
      const invariants = ctx.artifacts.invariants;
      const attacks = ctx.artifacts.attacks;
      const specialistSummary = ctx.artifacts.specialistSummary;
      const specialistContext = ctx.artifacts.specialistContext as AIRuntimeContext | undefined;
      if (!graph || !invariants || !attacks || !specialistSummary || !specialistContext) {
        return { status: "skipped", skipReason: "Missing runtime prerequisites." };
      }
      const runtimeContext: AIRuntimeContext = {
        ...specialistContext,
        llmTeamRunId: String(ctx.metadata.llmTeamRunId ?? ctx.runId),
        graph: graph as never,
        invariants: invariants as never,
        attacks: attacks as never,
        specialistSummary: specialistSummary as never,
        profile: DEFAULT_AI_RUNTIME_PROFILE,
        budget: DEFAULT_AI_RUNTIME_BUDGET,
        limits: DEFAULT_AI_RUNTIME_LIMITS,
      };
      const runtimeSummary = await runAiSafeRuntime({ context: runtimeContext });
      return {
        status: "completed",
        outputs: { runtimeSummary, "artifact:execution": runtimeSummary },
      };
    },
    evidence: async (ctx) => {
      const runtimeSummary = ctx.artifacts.runtimeSummary as { results: Array<{ evidence: unknown[] }> } | undefined;
      if (!runtimeSummary) return { status: "skipped", skipReason: "No runtime summary." };
      const count = runtimeSummary.results.reduce((n, r) => n + r.evidence.length, 0);
      return { status: "completed", outputs: { evidenceCount: count, "artifact:evidence": count } };
    },
    confidence: async (ctx) => {
      return { status: "completed", outputs: { "artifact:confidence": "evidence_weighted" } };
    },
    findings: async (ctx) => {
      const discovery = discoveryReport(ctx);
      const inventory = ctx.artifacts.inventory;
      const graph = ctx.artifacts.graph;
      const invariants = ctx.artifacts.invariants;
      const attacks = ctx.artifacts.attacks;
      const specialistSummary = ctx.artifacts.specialistSummary;
      const runtimeSummary = ctx.artifacts.runtimeSummary;
      if (!inventory || !graph || !invariants || !attacks || !specialistSummary || !runtimeSummary) {
        return { status: "skipped", skipReason: "Missing findings prerequisites." };
      }
      const findings = buildAiFindings({
        llmTeamRunId: String(ctx.metadata.llmTeamRunId ?? stableAiId(`llm-run:${(graph as { id: string }).id}`)),
        discovery,
        inventory: inventory as never,
        graph: graph as never,
        invariants: invariants as never,
        attacks: attacks as never,
        specialistSummary: specialistSummary as never,
        runtimeSummary: runtimeSummary as never,
      });
      return { status: "completed", outputs: { findings, "artifact:findings": findings } };
    },
    replay: async (ctx) => {
      const findings = ctx.artifacts.findings as { findings: Array<{ replayPlan: unknown }> } | undefined;
      if (!findings) return { status: "skipped", skipReason: "No findings." };
      return {
        status: "completed",
        outputs: {
          replayPlanCount: findings.findings.length,
          "artifact:replay": findings.findings.map((f) => f.replayPlan),
        },
      };
    },
    coverage: async (ctx) => {
      const graph = ctx.artifacts.graph as { nodes: unknown[] } | undefined;
      const invariants = ctx.artifacts.invariants as { invariants: unknown[] } | undefined;
      const attacks = ctx.artifacts.attacks as { cases: unknown[] } | undefined;
      const specialistSummary = ctx.artifacts.specialistSummary as { specialistsCompleted: number } | undefined;
      const runtimeSummary = ctx.artifacts.runtimeSummary as { plansCompleted: number } | undefined;
      const findings = ctx.artifacts.findings as { findings: unknown[] } | undefined;
      const coveragePercent = computeStepCoverage([
        (graph?.nodes.length ?? 0) > 0,
        (invariants?.invariants.length ?? 0) > 0,
        (attacks?.cases.length ?? 0) > 0,
        (specialistSummary?.specialistsCompleted ?? 0) > 0,
        (runtimeSummary?.plansCompleted ?? 0) > 0,
        (findings?.findings.length ?? 0) >= 0,
      ]);
      return { status: "completed", outputs: { coveragePercent, "artifact:coverage": coveragePercent } };
    },
    platform_integration: async () => ({
      status: "skipped",
      skipReason: "Platform payload built by LlmTeamAgent (unchanged public adapter).",
    }),
  };
}
