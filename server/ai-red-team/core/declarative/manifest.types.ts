import type { CapabilityCategory } from "../capabilities/capability.types";

export type ManifestVersion = {
  major: number;
  minor: number;
  patch: number;
};

export type DeclarativeModuleRef = {
  id: string;
  version: ManifestVersion;
  description: string;
  priority: number;
  requiredCapabilities: string[];
  optionalCapabilities?: string[];
  metadata?: Record<string, unknown>;
};

export type DiscoveryDeclaration = DeclarativeModuleRef & {
  contracts: string[];
  dependencies?: string[];
};

export type GraphDeclaration = DeclarativeModuleRef & {
  nodeKinds: string[];
  edgeKinds: string[];
  traversalRules: string[];
  validationRules: string[];
};

export type InvariantDeclaration = DeclarativeModuleRef & {
  categories: string[];
  confidenceRules: string[];
  violationRules: string[];
};

export type AttackDeclaration = DeclarativeModuleRef & {
  categories: string[];
  templates: string[];
  requiredPreconditions: string[];
  protectedAssets: string[];
  expectedEvidence: string[];
};

export type SpecialistDeclaration = DeclarativeModuleRef & {
  supportedAttackCategories: string[];
  supportedAssets: string[];
  supportedBoundaries: string[];
  supportedArchitectures: string[];
  runtimeProfiles: string[];
  estimatedCostMs: number;
};

export type RuntimeProfileDeclaration = {
  id: string;
  label: string;
  mode: "static" | "simulation" | "mock" | "replay" | "validation" | "safe_runtime" | "hybrid";
  priority: number;
  requiredCapabilities: string[];
};

export type FindingDeclaration = DeclarativeModuleRef & {
  findingTypes: string[];
  severityRules: string[];
  confidenceRules: string[];
  evidenceRequirements: string[];
  correlationRules: string[];
  replayRules: string[];
};

export type CoverageProviderDeclaration = DeclarativeModuleRef;
export type TelemetryProviderDeclaration = DeclarativeModuleRef;
export type PlatformAdapterDeclaration = DeclarativeModuleRef & {
  adapterKind: "rt4" | "rt5" | "rt12" | "rt13" | "mission_control";
};

/** Entry point for every Red Team plugin. */
export type RedTeamManifest = {
  id: string;
  name: string;
  version: ManifestVersion;
  description: string;
  supportedDomains: string[];
  supportedCapabilities: string[];
  dependencies: string[];
  discoveryModules: DiscoveryDeclaration[];
  graphBuilders: GraphDeclaration[];
  trustBoundaryBuilders: DeclarativeModuleRef[];
  invariantBuilders: InvariantDeclaration[];
  attackGenerators: AttackDeclaration[];
  specialists: SpecialistDeclaration[];
  runtimeProfiles: RuntimeProfileDeclaration[];
  findingBuilders: FindingDeclaration[];
  coverageProviders: CoverageProviderDeclaration[];
  telemetryProviders: TelemetryProviderDeclaration[];
  platformAdapters: PlatformAdapterDeclaration[];
  metadata: Record<string, unknown>;
};

export type ManifestCapabilityBinding = {
  capabilityId: string;
  category: CapabilityCategory;
  required: boolean;
};
