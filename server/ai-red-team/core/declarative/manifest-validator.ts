import type { RedTeamManifest, RuntimeProfileDeclaration } from "./manifest.types";
import { CANONICAL_PIPELINE_STAGE_ORDER } from "./canonical-stages";
import type { CapabilityRegistry } from "../capabilities/capability-registry";

export type ManifestValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type ManifestValidationResult = {
  valid: boolean;
  issues: ManifestValidationIssue[];
};

const RUNTIME_PROFILE_MODES = new Set<RuntimeProfileDeclaration["mode"]>([
  "static",
  "simulation",
  "mock",
  "replay",
  "validation",
  "safe_runtime",
  "hybrid",
]);

function semverOk(v: RedTeamManifest["version"]): boolean {
  return (
    Number.isInteger(v.major) &&
    Number.isInteger(v.minor) &&
    Number.isInteger(v.patch) &&
    v.major >= 0 &&
    v.minor >= 0 &&
    v.patch >= 0
  );
}

function collectModuleIds(manifest: RedTeamManifest): string[] {
  const ids: string[] = [];
  const push = (list: Array<{ id: string }>) => {
    for (const item of list) ids.push(item.id);
  };
  push(manifest.discoveryModules);
  push(manifest.graphBuilders);
  push(manifest.trustBoundaryBuilders);
  push(manifest.invariantBuilders);
  push(manifest.attackGenerators);
  push(manifest.specialists);
  push(manifest.findingBuilders);
  push(manifest.coverageProviders);
  push(manifest.telemetryProviders);
  push(manifest.platformAdapters);
  for (const rp of manifest.runtimeProfiles) ids.push(rp.id);
  return ids;
}

function detectDuplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  return dupes;
}

function detectPluginCycle(manifestId: string, deps: string[], known: Set<string>): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (id: string): boolean => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) {
      path.push(id);
      return true;
    }
    visiting.add(id);
    if (id === manifestId) {
      // dependencies refer to capability/plugin ids — only cycle among known manifest ids
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const dep of [...deps].sort((a, b) => a.localeCompare(b))) {
    if (known.has(dep) && visit(dep)) return path;
  }
  return [];
}

/** Strict Red Team manifest validation (deterministic issue ordering). */
export function validateRedTeamManifest(
  manifest: RedTeamManifest,
  options?: {
    capabilityRegistry?: CapabilityRegistry;
    registeredManifestIds?: string[];
    rejectDuplicateManifestId?: boolean;
  }
): ManifestValidationResult {
  const issues: ManifestValidationIssue[] = [];

  if (!manifest.id?.trim()) {
    issues.push({ code: "missing_id", message: "Manifest id is required.", path: "id" });
  }
  if (!manifest.name?.trim()) {
    issues.push({ code: "missing_name", message: "Manifest name is required.", path: "name" });
  }
  if (!semverOk(manifest.version)) {
    issues.push({ code: "invalid_version", message: "Manifest version must be semver integers.", path: "version" });
  }
  if (!manifest.supportedDomains?.length) {
    issues.push({ code: "missing_domain", message: "At least one supported domain is required.", path: "supportedDomains" });
  }
  const status = manifest.metadata?.status;
  if (typeof status !== "string" || !status.trim()) {
    issues.push({
      code: "missing_status",
      message: "metadata.status is required (e.g. stable, private-beta).",
      path: "metadata.status",
    });
  }
  if (!manifest.supportedCapabilities?.length) {
    issues.push({
      code: "missing_supported_capabilities",
      message: "supportedCapabilities must list at least one pipeline capability.",
      path: "supportedCapabilities",
    });
  }

  if (options?.rejectDuplicateManifestId && options.registeredManifestIds?.includes(manifest.id)) {
    issues.push({ code: "duplicate_manifest_id", message: `Duplicate manifest id ${manifest.id}.`, path: "id" });
  }

  const moduleIds = collectModuleIds(manifest);
  for (const dupe of detectDuplicateIds(moduleIds)) {
    issues.push({ code: "duplicate_module_id", message: `Duplicate module id ${dupe}.`, path: dupe });
  }

  const registry = options?.capabilityRegistry;
  const allCapRefs = new Set<string>();
  const addCaps = (caps: string[]) => caps.forEach((c) => allCapRefs.add(c));
  addCaps(manifest.supportedCapabilities ?? []);
  addCaps(manifest.dependencies ?? []);
  for (const mod of [
    ...manifest.discoveryModules,
    ...manifest.graphBuilders,
    ...manifest.invariantBuilders,
    ...manifest.attackGenerators,
    ...manifest.specialists,
    ...manifest.findingBuilders,
    ...manifest.coverageProviders,
    ...manifest.telemetryProviders,
    ...manifest.platformAdapters,
  ]) {
    addCaps(mod.requiredCapabilities ?? []);
    addCaps(mod.optionalCapabilities ?? []);
  }
  for (const rp of manifest.runtimeProfiles) addCaps(rp.requiredCapabilities ?? []);

  if (registry) {
    for (const capId of [...allCapRefs].sort((a, b) => a.localeCompare(b))) {
      if (!registry.getCapability(capId)) {
        issues.push({
          code: "invalid_capability_reference",
          message: `Unknown capability ${capId}.`,
          path: capId,
        });
      }
    }
    const roots = [...manifest.supportedCapabilities].sort((a, b) => a.localeCompare(b));
    const resolution = registry.resolveDependencies(roots);
    for (const missing of resolution.missing) {
      issues.push({
        code: "unresolved_capability_dependency",
        message: `Unresolved capability dependency ${missing}.`,
        path: missing,
      });
    }
  }

  for (const rp of manifest.runtimeProfiles) {
    if (!RUNTIME_PROFILE_MODES.has(rp.mode)) {
      issues.push({
        code: "unsupported_runtime_profile",
        message: `Unsupported runtime profile mode ${rp.mode}.`,
        path: `runtimeProfiles.${rp.id}`,
      });
    }
  }

  const canonical = new Set<string>(CANONICAL_PIPELINE_STAGE_ORDER);
  const declaredStages = manifest.metadata?.canonicalStages;
  if (Array.isArray(declaredStages)) {
    for (let i = 1; i < declaredStages.length; i++) {
      const prev = declaredStages[i - 1] as string;
      const cur = declaredStages[i] as string;
      const pi = CANONICAL_PIPELINE_STAGE_ORDER.indexOf(prev as (typeof CANONICAL_PIPELINE_STAGE_ORDER)[number]);
      const ci = CANONICAL_PIPELINE_STAGE_ORDER.indexOf(cur as (typeof CANONICAL_PIPELINE_STAGE_ORDER)[number]);
      if (pi >= 0 && ci >= 0 && ci < pi) {
        issues.push({
          code: "invalid_stage_ordering",
          message: `Stage ${cur} cannot precede ${prev} in canonical order.`,
          path: "metadata.canonicalStages",
        });
      }
      if (!canonical.has(cur)) {
        issues.push({
          code: "invalid_stage_id",
          message: `Unknown pipeline stage ${cur}.`,
          path: "metadata.canonicalStages",
        });
      }
    }
  }

  const knownManifests = new Set(options?.registeredManifestIds ?? []);
  const cycle = detectPluginCycle(manifest.id, manifest.dependencies ?? [], knownManifests);
  if (cycle.length) {
    issues.push({
      code: "cyclic_plugin_dependency",
      message: `Cyclic plugin dependency involving ${cycle.join(" -> ")}.`,
      path: "dependencies",
    });
  }

  if (!manifest.findingBuilders.length) {
    issues.push({ code: "undeclared_findings_output", message: "findingBuilders must be declared.", path: "findingBuilders" });
  }

  issues.sort((a, b) => `${a.code}:${a.path ?? ""}`.localeCompare(`${b.code}:${b.path ?? ""}`));

  return { valid: issues.length === 0, issues };
}
