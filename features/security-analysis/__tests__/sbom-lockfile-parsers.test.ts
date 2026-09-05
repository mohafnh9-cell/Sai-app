import { describe, expect, it } from "vitest";
import { createSbomComponent } from "../sbom/component";
import {
  buildSbomSnapshot,
  discoverComponentsFromFiles,
  parseLockfile,
} from "../sbom/lockfile-parsers";

const PACKAGE_LOCK = JSON.stringify(
  {
    name: "demo-app",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "demo-app",
        version: "1.0.0",
        dependencies: {
          lodash: "4.17.20",
          leftpad: "1.0.0",
        },
      },
      "node_modules/lodash": {
        version: "4.17.20",
      },
      "node_modules/leftpad": {
        version: "1.0.0",
      },
    },
  },
  null,
  2
);

describe("sbom lockfile parsers", () => {
  it("discovers npm components from package-lock.json", () => {
    const components = parseLockfile("package-lock.json", PACKAGE_LOCK);
    expect(components.some((component) => component.name === "lodash" && component.version === "4.17.20")).toBe(true);
    expect(components.some((component) => component.name === "leftpad")).toBe(true);
  });

  it("builds SBOM snapshot metadata from repository files", () => {
    const snapshot = buildSbomSnapshot([
      { path: "package.json", content: '{"name":"demo-app","version":"1.0.0"}' },
      { path: "package-lock.json", content: PACKAGE_LOCK },
    ]);

    expect(snapshot.metadata.name).toBe("demo-app");
    expect(snapshot.metadata.total).toBeGreaterThan(0);
    expect(snapshot.metadata.lockfiles).toContain("package-lock.json");
    expect(snapshot.metadata.ecosystems).toContain("npm");
  });

  it("deduplicates identical components across lockfiles", () => {
    const component = createSbomComponent({
      name: "lodash",
      version: "4.17.20",
      ecosystem: "npm",
      lockfilePath: "package-lock.json",
    });
    const components = discoverComponentsFromFiles([
      { path: "package-lock.json", content: PACKAGE_LOCK },
      { path: "apps/web/package-lock.json", content: PACKAGE_LOCK },
    ]);
    const lodashEntries = components.filter((entry) => entry.name === "lodash");
    expect(lodashEntries).toHaveLength(1);
    expect(lodashEntries[0]?.purl).toBe(component.purl);
  });

  it("returns empty components for unsupported lockfiles", () => {
    expect(parseLockfile("Gemfile.lock", "GEM\n  remote: https://rubygems.org/")).toEqual([]);
  });
});

describe("Phase 31.1 -- pnpm-lock.yaml parser correctness (real next-saas-starter structures)", () => {
  it("extracts a normal dependency", () => {
    const content = [
      "packages:",
      "",
      "  debug@4.4.1:",
      "    resolution: {integrity: sha512-abc==}",
      "    engines: {node: '>=6.0'}",
    ].join("\n");
    const components = parseLockfile("pnpm-lock.yaml", content);
    expect(components.some((c) => c.name === "debug" && c.version === "4.4.1")).toBe(true);
  });

  it("extracts a scoped dependency", () => {
    const content = ["packages:", "", "  '@radix-ui/rect@1.1.1':", "    resolution: {integrity: sha512-xyz==}"].join(
      "\n"
    );
    const components = parseLockfile("pnpm-lock.yaml", content);
    expect(components.some((c) => c.name === "@radix-ui/rect" && c.version === "1.1.1")).toBe(true);
  });

  it("does not fabricate a dependency from a peerDependenciesMeta block (the real reproduction case)", () => {
    // Reproduces the exact structure from leerob/next-saas-starter's real
    // pnpm-lock.yaml that previously fused "- supports-color" (a
    // transitivePeerDependencies list item, no "@version") with the
    // following unrelated package header across a blank line.
    const content = [
      "packages:",
      "",
      "  debug@4.4.1:",
      "    resolution: {integrity: sha512-abc==}",
      "    engines: {node: '>=6.0'}",
      "    peerDependencies:",
      "      supports-color: '*'",
      "    peerDependenciesMeta:",
      "      supports-color:",
      "        optional: true",
      "",
      "  csstype@3.1.3:",
      "    resolution: {integrity: sha512-def==}",
      "",
      "snapshots:",
      "",
      "  drizzle-kit@0.31.1:",
      "    dependencies:",
      "      esbuild: 0.25.4",
      "    transitivePeerDependencies:",
      "      - supports-color",
      "",
      "  drizzle-orm@0.43.1(gel@2.1.0)(postgres@3.4.5):",
      "    optionalDependencies:",
      "      gel: 2.1.0",
    ].join("\n");
    const components = parseLockfile("pnpm-lock.yaml", content);
    const names = components.map((c) => c.name);
    expect(names.some((n) => n.includes("supports-color"))).toBe(false);
    expect(names.some((n) => n.includes("\n"))).toBe(false);
    // The real neighboring packages must still be extracted correctly, not fused away.
    expect(components.some((c) => c.name === "debug" && c.version === "4.4.1")).toBe(true);
    expect(components.some((c) => c.name === "csstype" && c.version === "3.1.3")).toBe(true);
    expect(components.some((c) => c.name === "drizzle-orm")).toBe(true);
  });

  it("does not fabricate a dependency from nested transitivePeerDependencies metadata under multiple packages", () => {
    const content = [
      "snapshots:",
      "",
      "  eslint-plugin-x@1.0.0:",
      "    dependencies:",
      "      eslint: 8.57.0",
      "    transitivePeerDependencies:",
      "      - babel-plugin-macros",
      "      - supports-color",
      "",
      "  node-releases@2.0.19: {}",
    ].join("\n");
    const components = parseLockfile("pnpm-lock.yaml", content);
    const names = components.map((c) => c.name);
    expect(names.some((n) => n.includes("babel-plugin-macros"))).toBe(false);
    expect(names.some((n) => n.includes("supports-color"))).toBe(false);
    expect(components.some((c) => c.name === "node-releases" && c.version === "2.0.19")).toBe(true);
  });

  it("extracts a package name containing hyphens correctly", () => {
    const content = ["packages:", "", "  babel-plugin-macros@3.1.0:", "    resolution: {integrity: sha512-a==}"].join(
      "\n"
    );
    const components = parseLockfile("pnpm-lock.yaml", content);
    expect(components.some((c) => c.name === "babel-plugin-macros" && c.version === "3.1.0")).toBe(true);
  });

  it("does not treat a bare YAML list item (no @version) as a package, even alone", () => {
    const content = ["snapshots:", "", "  some-pkg@1.0.0:", "    transitivePeerDependencies:", "      - react"].join(
      "\n"
    );
    const components = parseLockfile("pnpm-lock.yaml", content);
    // Only "some-pkg" should be extracted; the "- react" list item must not
    // become its own component, nor fuse into a neighboring one.
    expect(components).toHaveLength(1);
    expect(components[0]?.name).toBe("some-pkg");
  });

  it("extracts an aliased/workspace-style version suffix without corrupting the base name", () => {
    const content = [
      "snapshots:",
      "",
      "  esbuild-register@3.6.0(esbuild@0.25.4):",
      "    dependencies:",
      "      esbuild: 0.25.4",
    ].join("\n");
    const components = parseLockfile("pnpm-lock.yaml", content);
    expect(components.some((c) => c.name === "esbuild-register")).toBe(true);
  });
});
