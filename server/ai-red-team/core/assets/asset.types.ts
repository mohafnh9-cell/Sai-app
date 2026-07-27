import type { CoreUniqueId } from "../contracts/identifiers";

/** Opaque asset type — domain teams define semantics. */
export type CoreProtectedAssetType = string;

export type CoreProtectedAsset = {
  id: CoreUniqueId;
  type: CoreProtectedAssetType;
  label: string;
  graphNodeIds: CoreUniqueId[];
  findingIds: CoreUniqueId[];
  metadata?: Record<string, unknown>;
};

export type CoreProtectedAssetRelationship = {
  fromAssetId: CoreUniqueId;
  toAssetId: CoreUniqueId;
  kind: string;
};

export type CoreProtectedAssetMetadata = {
  summarizedAt: string;
  source: string;
};

export type CoreProtectedAssetCollection = {
  id: CoreUniqueId;
  assets: CoreProtectedAsset[];
  relationships: CoreProtectedAssetRelationship[];
  metadata: CoreProtectedAssetMetadata;
};
