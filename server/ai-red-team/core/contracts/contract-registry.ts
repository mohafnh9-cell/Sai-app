/** Stable public contract identifiers — semantic versioning for platform freeze. */
export type ContractStability = "stable" | "internal" | "experimental" | "deprecated" | "compatibility";

export type ContractCompatibilityPolicy = {
  /** Minimum consumer version that can read this contract. */
  minConsumerVersion: string;
  /** Unknown fields policy for serialized payloads. */
  unknownFields: "ignore" | "reject";
  /** Breaking change policy summary. */
  breakingChanges: "major_bump_only";
};

export type StableContractDefinition = {
  contractId: string;
  semanticVersion: string;
  owner: "rt-core" | "rt9" | "rt10" | "platform";
  stability: ContractStability;
  description: string;
  compatibility: ContractCompatibilityPolicy;
  deprecation: { deprecated: boolean; replacementId: string | null; sunsetDate: string | null };
  serialization: "json" | "typescript_in_process";
  requiredFields: string[];
  optionalFields: string[];
  extensionPoints: string[];
};

export const RT_CORE_CONTRACT_VERSION = "1.0.0";

/** Authoritative freeze list — adapters must not rename these public surfaces. */
export const STABLE_CONTRACT_REGISTRY: StableContractDefinition[] = [
  {
    contractId: "sequrai.red-team.capability.descriptor",
    semanticVersion: "1.0.0",
    owner: "rt-core",
    stability: "stable",
    description: "Capability registration and resolution descriptors.",
    compatibility: { minConsumerVersion: "1.0.0", unknownFields: "ignore", breakingChanges: "major_bump_only" },
    deprecation: { deprecated: false, replacementId: null, sunsetDate: null },
    serialization: "typescript_in_process",
    requiredFields: ["id", "name", "version", "category", "requiredCapabilities"],
    optionalFields: ["optionalCapabilities", "conflictingCapabilities", "metadata"],
    extensionPoints: ["metadata", "category"],
  },
  {
    contractId: "sequrai.red-team.manifest",
    semanticVersion: "1.0.0",
    owner: "rt-core",
    stability: "stable",
    description: "RedTeamManifest plugin entry contract.",
    compatibility: { minConsumerVersion: "1.0.0", unknownFields: "ignore", breakingChanges: "major_bump_only" },
    deprecation: { deprecated: false, replacementId: null, sunsetDate: null },
    serialization: "typescript_in_process",
    requiredFields: ["id", "name", "version", "supportedDomains", "supportedCapabilities"],
    optionalFields: ["dependencies", "metadata"],
    extensionPoints: ["discoveryModules", "graphBuilders", "metadata"],
  },
  {
    contractId: "sequrai.red-team.pipeline.result",
    semanticVersion: "1.0.0",
    owner: "rt-core",
    stability: "internal",
    description: "Declarative pipeline execution result (in-process).",
    compatibility: { minConsumerVersion: "1.0.0", unknownFields: "ignore", breakingChanges: "major_bump_only" },
    deprecation: { deprecated: false, replacementId: null, sunsetDate: null },
    serialization: "typescript_in_process",
    requiredFields: ["status", "stageResults", "metadata", "durationMs"],
    optionalFields: ["context"],
    extensionPoints: ["metadata.explainability"],
  },
  {
    contractId: "sequrai.rt9.platform.payload",
    semanticVersion: "1.0.0",
    owner: "rt9",
    stability: "stable",
    description: "RT9 Business Logic platform integration payload (RT4/RT5/RT12/RT13/MC).",
    compatibility: { minConsumerVersion: "1.0.0", unknownFields: "ignore", breakingChanges: "major_bump_only" },
    deprecation: { deprecated: false, replacementId: null, sunsetDate: null },
    serialization: "json",
    requiredFields: ["findingSummary", "coverage", "decisionExposure", "missionControl"],
    optionalFields: ["ueeRemediationInputs", "asoOrchestration"],
    extensionPoints: ["observability", "metadata"],
  },
  {
    contractId: "sequrai.rt10.platform.payload",
    semanticVersion: "1.0.0",
    owner: "rt10",
    stability: "stable",
    description: "RT10 LLM platform integration payload.",
    compatibility: { minConsumerVersion: "1.0.0", unknownFields: "ignore", breakingChanges: "major_bump_only" },
    deprecation: { deprecated: false, replacementId: null, sunsetDate: null },
    serialization: "json",
    requiredFields: ["findingSummary", "trustSummary", "decisionExposure", "missionControl"],
    optionalFields: ["protectedAssetSummary", "attackPreconditionsSummary"],
    extensionPoints: ["layerCoverage", "observability"],
  },
  {
    contractId: "sequrai.red-team.attack.finding",
    semanticVersion: "1.0.0",
    owner: "platform",
    stability: "compatibility",
    description: "Legacy AttackFinding surface (RT1–RT13 consumers).",
    compatibility: { minConsumerVersion: "1.0.0", unknownFields: "ignore", breakingChanges: "major_bump_only" },
    deprecation: { deprecated: false, replacementId: null, sunsetDate: null },
    serialization: "json",
    requiredFields: ["id", "title", "domain", "severity", "confidence"],
    optionalFields: ["metadata"],
    extensionPoints: ["metadata"],
  },
];

export function getStableContract(contractId: string): StableContractDefinition | null {
  return STABLE_CONTRACT_REGISTRY.find((c) => c.contractId === contractId) ?? null;
}

export function listContractsByStability(stability: ContractStability): StableContractDefinition[] {
  return STABLE_CONTRACT_REGISTRY.filter((c) => c.stability === stability).sort((a, b) =>
    a.contractId.localeCompare(b.contractId)
  );
}
