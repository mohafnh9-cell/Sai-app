import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capability-registry";
import { registerCoreCapabilities } from "../register-core-capabilities";

describe("RT-Core CapabilityRegistry", () => {
  it("registers core capabilities without duplicates", () => {
    const registry = createCapabilityRegistry();
    registerCoreCapabilities(registry);
    expect(registry.listCapabilities().length).toBeGreaterThan(10);
    expect(() => registerCoreCapabilities(registry)).toThrow(/Duplicate/);
  });

  it("resolves dependency order for findings pipeline", () => {
    const registry = createCapabilityRegistry();
    registerCoreCapabilities(registry);
    const resolution = registry.resolveDependencies(["core.findings.engine"]);
    expect(resolution.missing).toEqual([]);
    expect(resolution.orderedCapabilityIds).toContain("core.graph.construction");
    expect(resolution.orderedCapabilityIds).toContain("core.findings.engine");
    expect(resolution.explainability.length).toBeGreaterThan(0);
  });

  it("detects conflicting capabilities", () => {
    const registry = createCapabilityRegistry();
    registry.registerCapability({
      id: "team.a.alpha",
      name: "Alpha",
      version: { major: 1, minor: 0, patch: 0 },
      category: "SafeRuntime",
      description: "A",
      supportedDomains: ["*"],
      providedContracts: [],
      requiredCapabilities: [],
      optionalCapabilities: [],
      status: "stable",
      compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
      metadata: {},
      conflictingCapabilities: ["team.b.beta"],
    });
    registry.registerCapability({
      id: "team.b.beta",
      name: "Beta",
      version: { major: 1, minor: 0, patch: 0 },
      category: "SafeRuntime",
      description: "B",
      supportedDomains: ["*"],
      providedContracts: [],
      requiredCapabilities: [],
      optionalCapabilities: [],
      status: "stable",
      compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
      metadata: {},
    });
    const conflicts = registry.detectConflicts(["team.a.alpha", "team.b.beta"]);
    expect(conflicts.length).toBe(1);
  });

  it("reports circular dependencies", () => {
    const registry = createCapabilityRegistry();
    registry.registerCapability({
      id: "circular.a",
      name: "A",
      version: { major: 1, minor: 0, patch: 0 },
      category: "Test",
      description: "A",
      supportedDomains: ["*"],
      providedContracts: [],
      requiredCapabilities: ["circular.b"],
      optionalCapabilities: [],
      status: "experimental",
      compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
      metadata: {},
    });
    registry.registerCapability({
      id: "circular.b",
      name: "B",
      version: { major: 1, minor: 0, patch: 0 },
      category: "Test",
      description: "B",
      supportedDomains: ["*"],
      providedContracts: [],
      requiredCapabilities: ["circular.a"],
      optionalCapabilities: [],
      status: "experimental",
      compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
      metadata: {},
    });
    const resolution = registry.resolveDependencies(["circular.a"]);
    expect(resolution.explainability[0]).toMatch(/Circular/);
  });

  it("validates version compatibility", () => {
    const registry = createCapabilityRegistry();
    registerCoreCapabilities(registry);
    const result = registry.checkVersionCompatibility("core.graph.construction", {
      major: 1,
      minor: 0,
      patch: 0,
    });
    expect(result.valid).toBe(true);
    const bad = registry.checkVersionCompatibility("core.graph.construction", {
      major: 99,
      minor: 0,
      patch: 0,
    });
    expect(bad.valid).toBe(false);
  });
});
