import type { CapabilityRegistry } from "../../capabilities/capability-registry";
import type { PluginDescriptor, PluginHealth, PluginValidationIssue } from "./plugin.types";
import { createDeclarativePipelineRunner } from "../pipeline/pipeline-registry";
import type { PipelineResult } from "../pipeline/pipeline.types";
import type { PipelineContext } from "../pipeline/pipeline.types";
import { validateRedTeamManifest } from "../manifest-validator";

export class PluginRegistry {
  private readonly plugins = new Map<string, PluginDescriptor>();

  register(descriptor: PluginDescriptor, options?: { capabilityRegistry?: CapabilityRegistry }): void {
    const validation = this.validate(descriptor, options);
    if (!validation.valid) {
      throw new Error(validation.issues.map((i) => i.message).join("; "));
    }
    this.plugins.set(descriptor.pluginId, descriptor);
  }

  get(pluginId: string): PluginDescriptor | null {
    return this.plugins.get(pluginId) ?? null;
  }

  list(): PluginDescriptor[] {
    return [...this.plugins.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }

  validate(
    descriptor: PluginDescriptor,
    options?: { capabilityRegistry?: CapabilityRegistry }
  ): { valid: boolean; issues: PluginValidationIssue[] } {
    const issues: PluginValidationIssue[] = [];
    if (!descriptor.manifest.id) {
      issues.push({ code: "missing_manifest_id", message: "Manifest id is required." });
    }
    if (descriptor.supportedStageIds.length === 0) {
      issues.push({ code: "no_stages", message: "Plugin must declare supported stages." });
    }
    if (!descriptor.rootCapabilityId) {
      issues.push({ code: "missing_root_capability", message: "rootCapabilityId is required." });
    }
    const manifestValidation = validateRedTeamManifest(descriptor.manifest, {
      capabilityRegistry: options?.capabilityRegistry,
      registeredManifestIds: [...this.plugins.values()]
        .filter((p) => p.pluginId !== descriptor.pluginId)
        .map((p) => p.manifest.id)
        .sort((a, b) => a.localeCompare(b)),
      rejectDuplicateManifestId: true,
    });
    for (const issue of manifestValidation.issues) {
      issues.push({ code: issue.code, message: issue.message });
    }
    return { valid: issues.length === 0, issues };
  }

  health(pluginId: string): PluginHealth {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return {
        status: "unregistered",
        message: `Plugin ${pluginId} is not registered.`,
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      status: "healthy",
      message: `Plugin ${pluginId} manifest ${plugin.manifest.version.major}.${plugin.manifest.version.minor}.${plugin.manifest.version.patch}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

export class PluginLoader {
  load(registry: PluginRegistry, descriptor: PluginDescriptor): void {
    registry.register(descriptor);
  }
}

export function createPluginRegistry(): PluginRegistry {
  return new PluginRegistry();
}

export async function executePluginPipeline(input: {
  plugin: PluginDescriptor;
  capabilityRegistry: CapabilityRegistry;
  context: PipelineContext;
}): Promise<PipelineResult> {
  const runner = createDeclarativePipelineRunner({
    manifestId: input.plugin.manifest.id,
    rootCapabilityId: input.plugin.rootCapabilityId,
    registry: input.capabilityRegistry,
    handlers: input.plugin.handlers,
    supportedStageIds: input.plugin.supportedStageIds,
  });
  return runner.execute({ context: input.context });
}

/** Process-wide plugin registry for auto-registration from team modules. */
export const globalPluginRegistry = createPluginRegistry();
