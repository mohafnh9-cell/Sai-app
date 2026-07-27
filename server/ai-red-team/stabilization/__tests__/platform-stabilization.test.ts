import { describe, expect, it } from "vitest";
import { createCapabilityRegistry, registerCoreCapabilities, buildCapabilityResolutionReport } from "../../core/capabilities";
import { validateRedTeamManifest } from "../../core/declarative/manifest-validator";
import { RT9_BUSINESS_LOGIC_MANIFEST } from "../../business-logic/declarative/manifest";
import { RT10_LLM_MANIFEST } from "../../llm-team/declarative/manifest";
import { createBusinessLogicCapabilityRegistry } from "../../business-logic/capabilities/register-business-logic-capabilities";
import { createLlmTeamCapabilityRegistry } from "../../llm-team/capabilities/register-llm-capabilities";
import { STABLE_CONTRACT_REGISTRY } from "../../core/contracts/contract-registry";
import { PipelinePlanner } from "../../core/declarative/pipeline/pipeline-planner";
import { validateReplayPlanSafety } from "../../core/replay/replay-safety-validator";
import { evaluateRuntimeSafety } from "../../core/runtime/runtime-safety-policy";

describe("platform stabilization — manifests", () => {
  it("validates RT9 manifest against capability registry", () => {
    const registry = createBusinessLogicCapabilityRegistry();
    const result = validateRedTeamManifest(RT9_BUSINESS_LOGIC_MANIFEST, { capabilityRegistry: registry });
    expect(result.valid, result.issues.map((i) => i.message).join("; ")).toBe(true);
  });

  it("validates RT10 manifest against capability registry", () => {
    const registry = createLlmTeamCapabilityRegistry();
    const result = validateRedTeamManifest(RT10_LLM_MANIFEST, { capabilityRegistry: registry });
    expect(result.valid, result.issues.map((i) => i.message).join("; ")).toBe(true);
  });
});

describe("platform stabilization — capability determinism", () => {
  it("produces identical resolution reports for shuffled roots", () => {
    const registry = createCapabilityRegistry();
    registerCoreCapabilities(registry);
    const roots = ["core.platform.integration", "core.graph.construction", "core.findings.engine"];
    const shuffled = [...roots].reverse();
    const a = buildCapabilityResolutionReport({ registry, requestedCapabilityIds: roots });
    const b = buildCapabilityResolutionReport({ registry, requestedCapabilityIds: shuffled });
    expect(a.finalExecutionOrder).toEqual(b.finalExecutionOrder);
    expect(a.resolvedCapabilities).toEqual(b.resolvedCapabilities);
  });
});

describe("platform stabilization — pipeline planning determinism", () => {
  it("plans identical stage order for RT9 and RT10 roots", () => {
    const registry = createBusinessLogicCapabilityRegistry();
    const planner = new PipelinePlanner();
    const rt9 = planner.plan({
      manifestId: RT9_BUSINESS_LOGIC_MANIFEST.id,
      registry,
      rootCapabilityId: "rt9.business_logic.pipeline",
    });
    const rt10Registry = createLlmTeamCapabilityRegistry();
    const rt10 = planner.plan({
      manifestId: RT10_LLM_MANIFEST.id,
      registry: rt10Registry,
      rootCapabilityId: "rt10.llm.pipeline",
    });
    expect(rt9.orderedStageIds).toEqual(rt10.orderedStageIds);
    expect(rt9.orderedStageIds.length).toBeGreaterThan(5);
  });
});

describe("platform stabilization — contract freeze", () => {
  it("lists stable platform contracts with semver", () => {
    const stable = STABLE_CONTRACT_REGISTRY.filter((c) => c.stability === "stable");
    expect(stable.length).toBeGreaterThanOrEqual(3);
    for (const c of stable) {
      expect(c.contractId).toMatch(/^sequrai\./);
      expect(c.semanticVersion).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe("platform stabilization — runtime and replay safety", () => {
  it("blocks production execution modes", () => {
    const evalResult = evaluateRuntimeSafety({
      mode: "production",
      productionMutationForbidden: true,
      allowStagingCandidateExecution: false,
      allowProductionLabeledTargets: false,
    });
    expect(evalResult.verdict).toBe("blocked");
  });

  it("rejects auto-executable replay plans", () => {
    const result = validateReplayPlanSafety({
      id: "rp1",
      findingId: "f1",
      sequence: { id: "s1", steps: [{ id: "st1", order: 1, kind: "step", label: "Observe", nodeId: null }] },
      expectedEvidence: [],
      metadata: { generatedAt: "2020-01-01T00:00:00.000Z", executable: true, expectedOutcome: "none" },
    });
    expect(result.status).toBe("Invalid");
  });
});
