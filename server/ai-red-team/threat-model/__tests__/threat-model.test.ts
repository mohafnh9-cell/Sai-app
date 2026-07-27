import { describe, expect, it } from "vitest";
import { buildThreatModel } from "../threat-model-builder";
import { serializeThreatModel, validateThreatModel, parseThreatModelJson } from "../validation";
import { threatChainFingerprint } from "../deterministic-id";
import { createThreatModelCapabilityRegistry } from "../capabilities/register-threat-model-capabilities";
import { registerCoreCapabilities } from "../../core/capabilities";
import type { ThreatModelBuildInput } from "../threat-model.types";

const SCOPE = {
  organizationId: "org-tm",
  projectId: "00000000-0000-4000-8000-000000000010",
  scanId: "00000000-0000-4000-8000-000000000011",
  executionId: "00000000-0000-4000-8000-000000000012",
  correlationId: "00000000-0000-4000-8000-000000000011",
};

function hybridInput(): ThreatModelBuildInput {
  return {
    scope: SCOPE,
    discovery: {
      reportId: "disc-1",
      potentialAttackSurface: [
        { area: "payments", label: "Checkout", confidence: 0.9 },
        { area: "llm", label: "Chat API", confidence: 0.88 },
        { area: "mcp_servers", label: "MCP", confidence: 0.85 },
      ],
      payments: [{ id: "stripe", name: "Stripe" }],
      aiProviders: [{ id: "openai", name: "OpenAI" }],
    },
    platform: {
      version: "1.0.0",
      missionControlPayload: { businessLogic: { ok: true }, llm: { ok: true } },
    },
    rt9: {
      workflows: 2,
      invariants: 3,
      findingIds: ["f-rt9-1"],
      protectedAssets: [{ id: "asset-sub", label: "Subscription State", type: "workflow" }],
      preconditions: [{ id: "pc-bl-1", label: "Authenticated member", blocking: [] }],
    },
    rt10: {
      graphNodeIds: ["n-prompt", "n-tool"],
      boundaryIds: ["b-tenant"],
      findingIds: ["f-rt10-1"],
      protectedAssets: [{ id: "asset-prompt", label: "System Prompt", type: "prompt" }],
      preconditions: [{ id: "pc-ai-1", label: "Tool reachable", unsupported: [] }],
    },
    intelligence: {
      reportId: "intel-1",
      correlations: [
        {
          kind: "cross_domain",
          findingIds: ["f-rt9-1", "f-rt10-1"],
          domains: ["payments", "llm"],
        },
      ],
    },
  };
}

describe("Threat Modeling Framework", () => {
  it("rejects models without minimum evidence", () => {
    const result = buildThreatModel({
      scope: SCOPE,
      discovery: { reportId: "d", potentialAttackSurface: [], payments: [], aiProviders: [] },
    });
    expect(result.model).toBeNull();
    expect(result.rejectedReason).toBe("insufficient_evidence");
  });

  it("builds actors, surfaces, paths, and chains from platform evidence", () => {
    const result = buildThreatModel(hybridInput());
    expect(result.model).not.toBeNull();
    expect(result.model!.actors.length).toBeGreaterThan(0);
    expect(result.model!.surfaces.length).toBeGreaterThan(0);
    expect(result.model!.paths.length).toBeGreaterThan(0);
    expect(result.model!.chains.length).toBeGreaterThan(0);
    expect(result.model!.objectives.every((o) => o.protectedAssetIds.length > 0)).toBe(true);
    expect(result.model!.chains.every((c) => c.preconditionIds.length > 0)).toBe(true);
  });

  it("produces deterministic fingerprints for identical input", () => {
    const a = buildThreatModel(hybridInput());
    const b = buildThreatModel(hybridInput());
    expect(a.model!.metadata.fingerprint).toBe(b.model!.metadata.fingerprint);
    expect(a.model!.chains.map((c) => c.fingerprint)).toEqual(b.model!.chains.map((c) => c.fingerprint));
  });

  it("blocks feasibility when unsupported preconditions present", () => {
    const input = hybridInput();
    input.rt10!.preconditions = [{ id: "x", label: "unsupported", unsupported: ["production_mcp"] }];
    const result = buildThreatModel(input);
    expect(result.model!.chains.some((c) => c.feasibility === "blocked")).toBe(true);
  });

  it("requires cross-team evidence for cross-team chains", () => {
    const input = hybridInput();
    delete input.intelligence;
    const result = buildThreatModel(input);
    expect(result.model!.chains.every((c) => !c.crossTeam)).toBe(true);
  });

  it("serializes and parses threat models", () => {
    const built = buildThreatModel(hybridInput());
    const json = serializeThreatModel(built.model!);
    const parsed = parseThreatModelJson(JSON.parse(json));
    expect(parsed?.context.scope.scanId).toBe(SCOPE.scanId);
    expect(parsed?.version).toBe("1.0.0");
  });

  it("registers threat model capabilities", () => {
    const registry = createThreatModelCapabilityRegistry();
    registerCoreCapabilities(registry);
    expect(registry.getCapability("rt11.threat_model.construction")).toBeTruthy();
  });

  it("validates objective asset linkage", () => {
    const built = buildThreatModel(hybridInput());
    const validation = validateThreatModel(built.model!);
    expect(validation.valid).toBe(true);
  });

  it("chain fingerprint is stable", () => {
    const fp = threatChainFingerprint({
      scope: SCOPE,
      pathLogicalId: "tm:path",
      stepKinds: ["entry_point", "precondition", "objective"],
      assetIds: ["a1"],
      objectiveKind: "tool_abuse",
    });
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });
});
