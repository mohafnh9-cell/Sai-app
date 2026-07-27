import type { RedTeamManifest } from "../manifest.types";
import type { PipelineStageHandlers } from "../pipeline/pipeline.types";
import type { ManifestVersion } from "../manifest.types";

export type PluginVersion = ManifestVersion;

export type PluginDependencies = {
  capabilities: string[];
  manifests: string[];
};

export type PluginMetadata = Record<string, unknown>;

export type PluginCapabilities = {
  provides: string[];
  requires: string[];
};

export type PluginHealth = {
  status: "healthy" | "degraded" | "unregistered";
  message: string;
  checkedAt: string;
};

export type PluginValidationIssue = {
  code: string;
  message: string;
};

export type PluginDescriptor = {
  pluginId: string;
  manifest: RedTeamManifest;
  handlers: PipelineStageHandlers;
  supportedStageIds: import("../canonical-stages").CanonicalPipelineStageId[];
  rootCapabilityId: string;
  metadata: PluginMetadata;
};

export type PluginRegistration = PluginDescriptor & {
  registeredAt: string;
};
