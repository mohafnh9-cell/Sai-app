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
