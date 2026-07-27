import type { CapabilityRegistry } from "./capability-registry";
import type { CapabilityVersion } from "./capability.types";

export type CapabilityVersionDecision = {
  capabilityId: string;
  offeredVersion: string;
  requiredMinVersion: string | null;
  compatible: boolean;
};

export type CapabilityResolutionReport = {
  reportId: string;
  generatedAt: string;
  requestedCapabilities: string[];
  resolvedCapabilities: string[];
  rejectedCapabilities: string[];
  missingDependencies: string[];
  conflicts: Array<{ a: string; b: string; reason: string }>;
  versionDecisions: CapabilityVersionDecision[];
  finalExecutionOrder: string[];
  explainability: string[];
};

function versionKey(v: CapabilityVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** Deterministic capability resolution report (sorted; no map iteration dependence). */
export function buildCapabilityResolutionReport(input: {
  registry: CapabilityRegistry;
  requestedCapabilityIds: string[];
  requiredMinVersions?: Record<string, CapabilityVersion>;
}): CapabilityResolutionReport {
  const requested = [...new Set(input.requestedCapabilityIds)].sort((a, b) => a.localeCompare(b));
  const rejected: string[] = [];
  const versionDecisions: CapabilityVersionDecision[] = [];

  for (const id of requested) {
    const cap = input.registry.getCapability(id);
    if (!cap) {
      rejected.push(id);
      continue;
    }
    const requiredMin = input.requiredMinVersions?.[id];
    const compatible = input.registry.checkVersionCompatibility(id, requiredMin).valid;
    versionDecisions.push({
      capabilityId: id,
      offeredVersion: versionKey(cap.version),
      requiredMinVersion: requiredMin ? versionKey(requiredMin) : null,
      compatible,
    });
    if (!compatible) rejected.push(id);
  }

  const resolution = input.registry.resolveDependencies(requested.filter((id) => !rejected.includes(id)));
  const resolved = [...new Set(resolution.satisfied)].sort((a, b) => a.localeCompare(b));
  const missing = [...new Set(resolution.missing)].sort((a, b) => a.localeCompare(b));
  const order = [...resolution.orderedCapabilityIds];
  const conflicts = [...resolution.conflicts].sort((a, b) =>
    `${a.a}:${a.b}`.localeCompare(`${b.a}:${b.b}`)
  );

  return {
    reportId: `cap-res:${requested.join(",")}`,
    generatedAt: "1970-01-01T00:00:00.000Z",
    requestedCapabilities: requested,
    resolvedCapabilities: resolved,
    rejectedCapabilities: [...new Set(rejected)].sort((a, b) => a.localeCompare(b)),
    missingDependencies: missing,
    conflicts,
    versionDecisions: versionDecisions.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId)),
    finalExecutionOrder: order,
    explainability: resolution.explainability,
  };
}
