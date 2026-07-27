import type { CoreUniqueId } from "../contracts/identifiers";
import type { CoreEvidence } from "../evidence/evidence.types";

export type CoreBoundaryType = string;

export type CoreTrustBoundary = {
  id: CoreUniqueId;
  kind: CoreBoundaryType;
  label: string;
  confidence: number;
  nodeIds: CoreUniqueId[];
  metadata?: Record<string, unknown>;
};

export type CoreBoundaryEvidence = CoreEvidence<"discovery" | "graph" | "invariant">;

export type CoreBoundaryRelationship = {
  fromBoundaryId: CoreUniqueId;
  toBoundaryId: CoreUniqueId;
  kind: string;
};

export type CoreBoundaryViolation = {
  id: CoreUniqueId;
  boundaryId: CoreUniqueId;
  detail: string;
  severity: string;
};

export type CoreBoundaryMetadata = {
  extractedAt: string;
  source: string;
};

export type CoreBoundaryCollection = {
  id: CoreUniqueId;
  boundaries: CoreTrustBoundary[];
  relationships: CoreBoundaryRelationship[];
  metadata: CoreBoundaryMetadata;
};
