import { describe, expect, it } from "vitest";
import { createCapabilityRegistry, registerCoreCapabilities } from "../../capabilities";
import { createPipelinePlanner } from "../pipeline/pipeline-planner";
import { PipelineExecutor } from "../pipeline/pipeline-executor";
import { CANONICAL_PIPELINE_STAGE_ORDER } from "../canonical-stages";

describe("RT-Core Declarative Pipeline", () => {
  it("plans deterministic stage order", () => {
    const registry = createCapabilityRegistry();
    registerCoreCapabilities(registry);
    registry.registerCapability({
      id: "test.team.pipeline",
      name: "Test",
      version: { major: 1, minor: 0, patch: 0 },
      category: "PlatformIntegration",
      description: "Test pipeline",
      supportedDomains: ["*"],
      providedContracts: [],
      requiredCapabilities: ["core.findings.engine"],
      optionalCapabilities: [],
      status: "stable",
      compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
      metadata: {},
    });

    const planner = createPipelinePlanner();
    const plan = planner.plan({
      manifestId: "test.team",
      registry,
      rootCapabilityId: "test.team.pipeline",
    });

    expect(plan.orderedStageIds[0]).toBe("discovery");
    expect(plan.orderedStageIds).toContain("findings");
    expect(plan.orderedStageIds.length).toBe(CANONICAL_PIPELINE_STAGE_ORDER.length);
  });

  it("executes stages and reuses artifacts", async () => {
    const registry = createCapabilityRegistry();
    registerCoreCapabilities(registry);
    const planner = createPipelinePlanner();
    const plan = planner.plan({
      manifestId: "exec.test",
      registry,
      rootCapabilityId: "core.findings.engine",
      supportedStageIds: ["discovery", "graph", "findings"],
    });

    const executor = new PipelineExecutor({
      discovery: async (ctx) => {
        if (ctx.artifacts["artifact:discovery"]) {
          return { status: "completed", reuseExisting: true };
        }
        return { status: "completed", outputs: { "artifact:discovery": { ok: true } } };
      },
      graph: async () => ({ status: "completed", outputs: { "artifact:graph": { nodes: [] } } }),
      findings: async () => ({ status: "completed", outputs: { "artifact:findings": { findings: [] } } }),
    });

    const context = {
      runId: "r1",
      requestId: "req",
      organizationId: "o",
      projectId: "p",
      artifacts: { "artifact:discovery": { ok: true } },
      metadata: {},
    };

    const result = await executor.execute(plan, { context });
    expect(["completed", "partial"]).toContain(result.status);
    const discovery = result.stageResults.find((s) => s.stageId === "discovery");
    expect(discovery?.reused).toBe(true);
  });
});
