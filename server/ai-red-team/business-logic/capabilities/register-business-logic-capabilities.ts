import {
  createCapabilityRegistry,
  registerCoreCapabilities,
  type CapabilityProvider,
  type CapabilityRegistry,
} from "../../core/capabilities";

export function registerBusinessLogicCapabilities(registry: CapabilityRegistry): CapabilityProvider {
  const provider: CapabilityProvider = {
    providerId: "rt9.business-logic",
    teamId: "business_logic",
    domain: "payments",
    capabilities: [
      {
        id: "rt9.business_logic.pipeline",
        name: "Business Logic Pipeline",
        version: { major: 1, minor: 0, patch: 0 },
        category: "PlatformIntegration",
        description: "RT9 workflow FSM, abuse, and payment-domain findings pipeline.",
        supportedDomains: ["payments"],
        providedContracts: ["BusinessLogicPlatformPayload"],
        requiredCapabilities: [
          "core.graph.construction",
          "core.invariants.extraction",
          "core.attacks.generation",
          "core.specialists.execution",
          "core.runtime.safe",
          "core.findings.engine",
          "core.platform.integration",
        ],
        optionalCapabilities: ["core.replay.generation", "core.coverage.analysis"],
        status: "stable",
        compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
        metadata: { team: "RT9" },
      },
    ],
  };
  registerCoreCapabilities(registry);
  registry.registerProvider(provider);
  return provider;
}

export function createBusinessLogicCapabilityRegistry(): CapabilityRegistry {
  const registry = createCapabilityRegistry();
  registerBusinessLogicCapabilities(registry);
  return registry;
}
