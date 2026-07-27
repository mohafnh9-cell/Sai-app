/** Extensible capability taxonomy — teams register new categories without editing RT-Core. */
export type CapabilityCategory = string;

export const KNOWN_CAPABILITY_CATEGORIES = [
  "GraphConstruction",
  "TrustBoundaryAnalysis",
  "InvariantExtraction",
  "AttackGeneration",
  "SpecialistExecution",
  "SafeRuntime",
  "EvidenceCollection",
  "ConfidencePropagation",
  "FindingCorrelation",
  "ReplayGeneration",
  "CoverageAnalysis",
  "BudgetEnforcement",
  "ProtectedAssetModeling",
  "AttackPreconditionModeling",
  "Telemetry",
  "PlatformIntegration",
] as const;

export type KnownCapabilityCategory = (typeof KNOWN_CAPABILITY_CATEGORIES)[number];

export type CapabilityVersion = {
  major: number;
  minor: number;
  patch: number;
};

export type CapabilityStatus = "experimental" | "beta" | "stable" | "deprecated";

export type CapabilityCompatibility = {
  minCoreVersion: string;
  maxCoreVersion: string | null;
};

export type CapabilityMetadata = Record<string, string | number | boolean | null>;

export type CapabilityDependency = {
  capabilityId: string;
  optional?: boolean;
  minVersion?: CapabilityVersion;
};

export type CapabilityDescriptor = {
  id: string;
  name: string;
  version: CapabilityVersion;
  category: CapabilityCategory;
  description: string;
  supportedDomains: string[];
  providedContracts: string[];
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  status: CapabilityStatus;
  compatibility: CapabilityCompatibility;
  metadata: CapabilityMetadata;
};

export type CapabilityRegistration = CapabilityDescriptor & {
  conflictingCapabilities?: string[];
  replacementFor?: string[];
  deprecatedBy?: string | null;
};

export type CapabilityProvider = {
  providerId: string;
  teamId: string;
  domain: string;
  capabilities: CapabilityRegistration[];
};

export type CapabilityConsumer = {
  consumerId: string;
  teamId: string;
  requiredCapabilities: string[];
  optionalCapabilities: string[];
};

export type CapabilityValidationIssue = {
  code:
    | "missing_required"
    | "version_incompatible"
    | "conflict"
    | "duplicate_id"
    | "circular_dependency"
    | "unknown_capability";
  message: string;
  capabilityId?: string;
};

export type CapabilityValidationResult = {
  valid: boolean;
  issues: CapabilityValidationIssue[];
};

export type CapabilityResolution = {
  orderedCapabilityIds: string[];
  satisfied: string[];
  missing: string[];
  conflicts: Array<{ a: string; b: string; reason: string }>;
  explainability: string[];
};

export type CapabilityRegistrySnapshot = {
  capabilities: CapabilityDescriptor[];
  providers: CapabilityProvider[];
  generatedAt: string;
};
