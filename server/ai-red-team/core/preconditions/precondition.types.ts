import type { CoreUniqueId } from "../contracts/identifiers";

export type CoreCapabilityRequirement = {
  capability: string;
  required: boolean;
};

export type CoreBoundaryRequirement = {
  boundaryId: CoreUniqueId;
  boundaryKind: string;
  required: boolean;
};

export type CoreExecutionRequirement = {
  executionPathId: CoreUniqueId | null;
  graphNodeIds: CoreUniqueId[];
  graphEdgeIds: CoreUniqueId[];
};

export type CoreArchitectureRequirement = {
  architecture: string;
  required: boolean;
};

export type CoreStateRequirement = {
  layer: string;
  description: string;
  required: boolean;
};

export type CoreEnvironmentRequirement = {
  id: CoreUniqueId;
  label: string;
  required: boolean;
};

export type CoreDependencyRequirement = {
  id: string;
  required: boolean;
};

export type CoreConfigurationRequirement = {
  key: string;
  required: boolean;
};

/** Generic attack precondition shell — domain teams extend with typed fields. */
export type CoreAttackPreconditions = {
  requiredAttackerCapability: string;
  requiredTrustBoundaries: CoreBoundaryRequirement[];
  requiredComponents: string[];
  requiredArchitecture: CoreArchitectureRequirement[];
  requiredEnvironment: CoreEnvironmentRequirement[];
  requiredConfiguration: CoreConfigurationRequirement[];
  requiredExecution: CoreExecutionRequirement;
  unsupportedConditions: string[];
  blockingConditions: string[];
  optionalConditions: string[];
};
