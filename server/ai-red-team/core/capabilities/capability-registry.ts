import type {
  CapabilityDescriptor,
  CapabilityProvider,
  CapabilityRegistration,
  CapabilityResolution,
  CapabilityValidationIssue,
  CapabilityValidationResult,
  CapabilityVersion,
} from "./capability.types";

function versionKey(v: CapabilityVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function compareVersion(a: CapabilityVersion, b: CapabilityVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function satisfiesMinVersion(
  offered: CapabilityVersion,
  required: CapabilityVersion | undefined
): boolean {
  if (!required) return true;
  return compareVersion(offered, required) >= 0;
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, CapabilityRegistration>();
  private readonly providers = new Map<string, CapabilityProvider>();

  registerCapability(registration: CapabilityRegistration): void {
    if (this.capabilities.has(registration.id)) {
      throw new Error(`Duplicate capability registration: ${registration.id}`);
    }
    this.capabilities.set(registration.id, registration);
  }

  registerProvider(provider: CapabilityProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(`Duplicate capability provider: ${provider.providerId}`);
    }
    for (const cap of provider.capabilities) {
      if (!this.capabilities.has(cap.id)) {
        this.registerCapability(cap);
      }
    }
    this.providers.set(provider.providerId, provider);
  }

  getCapability(id: string): CapabilityRegistration | null {
    return this.capabilities.get(id) ?? null;
  }

  listCapabilities(): CapabilityDescriptor[] {
    return [...this.capabilities.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  listProviders(): CapabilityProvider[] {
    return [...this.providers.values()].sort((a, b) => a.providerId.localeCompare(b.providerId));
  }

  validateConsumer(input: {
    required: string[];
    optional?: string[];
  }): CapabilityValidationResult {
    const issues: CapabilityValidationIssue[] = [];
    const optional = input.optional ?? [];

    for (const id of [...input.required, ...optional]) {
      if (!this.capabilities.has(id)) {
        issues.push({
          code: "unknown_capability",
          message: `Capability not registered: ${id}`,
          capabilityId: id,
        });
      }
    }

    for (const id of input.required) {
      if (!this.capabilities.has(id)) {
        issues.push({
          code: "missing_required",
          message: `Required capability missing: ${id}`,
          capabilityId: id,
        });
      }
    }

    const resolution = this.resolveDependencies(input.required);
    for (const issue of resolution.missing.map((id) => ({
      code: "missing_required" as const,
      message: `Transitive requirement missing: ${id}`,
      capabilityId: id,
    }))) {
      issues.push(issue);
    }

    if (resolution.conflicts.length > 0) {
      for (const c of resolution.conflicts) {
        issues.push({
          code: "conflict",
          message: c.reason,
          capabilityId: c.a,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }

  detectConflicts(capabilityIds: string[]): Array<{ a: string; b: string; reason: string }> {
    const conflicts: Array<{ a: string; b: string; reason: string }> = [];
    const selected = new Set(capabilityIds);
    for (const id of capabilityIds) {
      const cap = this.capabilities.get(id);
      if (!cap?.conflictingCapabilities) continue;
      for (const other of cap.conflictingCapabilities) {
        if (selected.has(other)) {
          conflicts.push({
            a: id,
            b: other,
            reason: `Capabilities ${id} and ${other} are marked as conflicting.`,
          });
        }
      }
    }
    return conflicts;
  }

  resolveDependencies(requiredRoots: string[]): CapabilityResolution {
    const explainability: string[] = [];
    const ordered: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const missing: string[] = [];
    const conflicts = this.detectConflicts(requiredRoots);

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Circular capability dependency detected at ${id}`);
      }
      visiting.add(id);
      const cap = this.capabilities.get(id);
      if (!cap) {
        missing.push(id);
        visiting.delete(id);
        return;
      }
      for (const dep of [...cap.requiredCapabilities].sort((a, b) => a.localeCompare(b))) {
        visit(dep);
      }
      visiting.delete(id);
      visited.add(id);
      ordered.push(id);
      explainability.push(`Resolved ${id}@${versionKey(cap.version)} (${cap.category})`);
    };

    try {
      for (const root of [...requiredRoots].sort((a, b) => a.localeCompare(b))) visit(root);
    } catch (err) {
      return {
        orderedCapabilityIds: [],
        satisfied: [],
        missing: [...missing, ...requiredRoots],
        conflicts,
        explainability: [
          err instanceof Error ? err.message : "Circular dependency",
          ...explainability,
        ],
      };
    }

    const satisfied = ordered.filter((id) => this.capabilities.has(id));
    const uniqueOrdered = [...new Set(ordered)];
    return {
      orderedCapabilityIds: uniqueOrdered,
      satisfied: [...new Set(satisfied)].sort((a, b) => a.localeCompare(b)),
      missing: [...new Set(missing)].sort((a, b) => a.localeCompare(b)),
      conflicts,
      explainability,
    };
  }

  checkVersionCompatibility(
    capabilityId: string,
    requiredMin?: CapabilityVersion
  ): CapabilityValidationResult {
    const cap = this.capabilities.get(capabilityId);
    const issues: CapabilityValidationIssue[] = [];
    if (!cap) {
      return {
        valid: false,
        issues: [{ code: "unknown_capability", message: `Unknown capability ${capabilityId}` }],
      };
    }
    if (!satisfiesMinVersion(cap.version, requiredMin)) {
      issues.push({
        code: "version_incompatible",
        message: `${capabilityId} version ${versionKey(cap.version)} below required ${requiredMin ? versionKey(requiredMin) : "?"}`,
        capabilityId,
      });
    }
    return { valid: issues.length === 0, issues };
  }

  explainCapability(id: string): string | null {
    const cap = this.capabilities.get(id);
    if (!cap) return null;
    return [
      `${cap.name} (${cap.id})`,
      `category=${cap.category}`,
      `version=${versionKey(cap.version)}`,
      `status=${cap.status}`,
      `requires=[${cap.requiredCapabilities.join(", ")}]`,
      `provides=[${cap.providedContracts.join(", ")}]`,
    ].join(" | ");
  }
}

export function createCapabilityRegistry(): CapabilityRegistry {
  return new CapabilityRegistry();
}
