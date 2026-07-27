import {
  createCapabilityRegistry,
  registerCoreCapabilities,
  type CapabilityProvider,
  type CapabilityRegistry,
} from "../../core/capabilities";

export function registerLlmTeamCapabilities(registry: CapabilityRegistry): CapabilityProvider {
  const provider: CapabilityProvider = {
    providerId: "rt10.llm",
    teamId: "llm",
    domain: "llm",
    capabilities: [
      {
        id: "rt10.llm.pipeline",
        name: "LLM Security Pipeline",
        version: { major: 1, minor: 0, patch: 0 },
        category: "PlatformIntegration",
        description: "RT10 AI execution graph, trust invariants, and safe runtime findings.",
        supportedDomains: ["llm"],
        providedContracts: ["LlmPlatformPayload"],
        requiredCapabilities: [
          "core.graph.construction",
          "core.boundaries.analysis",
          "core.invariants.extraction",
          "core.attacks.generation",
          "core.specialists.execution",
          "core.runtime.safe",
          "core.findings.engine",
          "core.assets.protected",
          "core.preconditions.model",
          "core.platform.integration",
        ],
        optionalCapabilities: ["core.replay.generation", "core.telemetry"],
        status: "stable",
        compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
        metadata: { team: "RT10" },
      },
    ],
  };
  registerCoreCapabilities(registry);
  registry.registerProvider(provider);
  return provider;
}

export function createLlmTeamCapabilityRegistry(): CapabilityRegistry {
  const registry = createCapabilityRegistry();
  registerLlmTeamCapabilities(registry);
  return registry;
}
