import {
  createCapabilityRegistry,
  type CapabilityProvider,
  type CapabilityRegistry,
} from "../../core/capabilities";

/** RT11 threat modeling capabilities — registered alongside team providers, not in RT-Core enum edits. */
export function registerThreatModelCapabilities(registry: CapabilityRegistry): CapabilityProvider {
  const provider: CapabilityProvider = {
    providerId: "rt11.threat-model.foundation",
    teamId: "threat_model",
    domain: "*",
    capabilities: [
      cap("rt11.threat_model.construction", "ThreatModelConstruction", "Build threat model from platform artifacts"),
      cap("rt11.threat_actor.modeling", "ThreatActorModeling", "Model threat actors from evidence"),
      cap("rt11.attack_surface.modeling", "AttackSurfaceModeling", "Derive attack surfaces from discovery and teams"),
      cap("rt11.threat_path.generation", "ThreatPathGeneration", "Generate threat paths"),
      cap("rt11.threat_chain.generation", "ThreatChainGeneration", "Generate multi-stage threat chains"),
      cap("rt11.threat.cross_team_correlation", "CrossTeamCorrelation", "Correlate RT9 and RT10 evidence"),
      cap("rt11.attack_cost.estimation", "AttackCostEstimation", "Estimate attack cost bands"),
      cap("rt11.threat_feasibility.scoring", "ThreatFeasibilityScoring", "Classify feasibility"),
      cap("rt11.threat_prioritization", "ThreatPrioritization", "Prioritize threat chains"),
      cap("rt11.threat_model.serialization", "ThreatSerialization", "Serialize and validate threat models"),
    ],
  };
  registry.registerProvider(provider);
  return provider;
}

function cap(id: string, category: string, description: string) {
  return {
    id,
    name: id.split(".").pop()!.replace(/_/g, " "),
    version: { major: 1, minor: 0, patch: 0 },
    category,
    description,
    supportedDomains: ["*"],
    providedContracts: ["ThreatModel"],
    requiredCapabilities: [
      "core.evidence.collection",
      "core.assets.protected",
      "core.preconditions.model",
      "core.boundaries.analysis",
    ],
    optionalCapabilities: ["core.platform.integration"],
    status: "beta" as const,
    compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
    metadata: { slice: "threat_model_foundation" },
  };
}

export function createThreatModelCapabilityRegistry(): CapabilityRegistry {
  const registry = createCapabilityRegistry();
  registerThreatModelCapabilities(registry);
  return registry;
}
