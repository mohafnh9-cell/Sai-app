import { describe, expect, it } from "vitest";
import { createTrivyEngine } from "../trivy/engine";

/**
 * Phase 35, section 41: REAL INTEGRATION VALIDATION. Skipped (not mocked)
 * when TRIVY_BINARY_PATH isn't set. Set it to a real Trivy v0.74.0 binary to
 * exercise it for real -- verified live during this phase against
 * CVE-2020-8203 (lodash prototype pollution) via a real `trivy fs` run; see
 * Phase 35 final report section 8 for the full manual verification
 * transcript. Note: this test needs real outbound network access on its
 * first run in a given TRIVY_CACHE_DIR (vulnerability DB download, ~112MB).
 */
const hasRealBinary = Boolean(process.env.TRIVY_BINARY_PATH?.trim());

const VULNERABLE_PACKAGE_JSON = JSON.stringify({
  name: "trivy-fixture",
  version: "1.0.0",
  dependencies: { lodash: "4.17.15" },
});
const VULNERABLE_LOCKFILE = JSON.stringify({
  name: "trivy-fixture",
  version: "1.0.0",
  lockfileVersion: 2,
  requires: true,
  packages: { "": { dependencies: { lodash: "4.17.15" } }, "node_modules/lodash": { version: "4.17.15" } },
  dependencies: { lodash: { version: "4.17.15" } },
});

describe.skipIf(!hasRealBinary)("TrivyEngine -- real subprocess execution", () => {
  it(
    "detects a real known CVE (CVE-2020-8203, lodash prototype pollution) in a vulnerable dependency fixture",
    async () => {
      const engine = createTrivyEngine();
      const result = await engine.execute({
        scanId: "scan-1",
        projectId: "project-1",
        organizationId: "org-1",
        files: [
          { path: "package.json", content: VULNERABLE_PACKAGE_JSON },
          { path: "package-lock.json", content: VULNERABLE_LOCKFILE },
        ],
        timeoutMs: 120_000,
      });

      expect(result.status).toBe("COMPLETED");
      const finding = result.findings.find((f) => f.title.includes("CVE-2020-8203"));
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("high");
      expect(finding?.evidence[0]?.kind).toBe("DEPENDENCY");
      expect(finding?.verificationStatus).toBe("LIKELY"); // never CONFIRMED from a static inventory match alone
      expect(finding?.remediation).toContain("4.17.19");
    },
    150_000
  );
});

describe("TrivyEngine -- applicability and skip semantics (no binary required)", () => {
  it("is not applicable when there is no dependency manifest, Dockerfile, or IaC file", () => {
    const engine = createTrivyEngine();
    const result = engine.applicability({ files: [{ path: "README.md" }] });
    expect(result.applicable).toBe(false);
  });

  it("is applicable when a package.json is present, matching the dependencies capability", () => {
    const engine = createTrivyEngine();
    const result = engine.applicability({ files: [{ path: "package.json" }] });
    expect(result.applicable).toBe(true);
    expect(result.matchedCapabilities).toContain("dependencies");
  });

  it("is applicable to a Dockerfile, matching the containers capability, but NOT the dependencies capability alone", () => {
    const engine = createTrivyEngine();
    const result = engine.applicability({ files: [{ path: "Dockerfile" }] });
    expect(result.applicable).toBe(true);
    expect(result.matchedCapabilities).toEqual(["containers"]);
  });

  it("SKIPS when TRIVY_BINARY_PATH is unset -- never '0 findings = safe'", async () => {
    const originalPath = process.env.TRIVY_BINARY_PATH;
    delete process.env.TRIVY_BINARY_PATH;
    try {
      const engine = createTrivyEngine();
      const result = await engine.execute({
        scanId: "scan-2",
        projectId: "project-1",
        organizationId: "org-1",
        files: [{ path: "package.json", content: VULNERABLE_PACKAGE_JSON }],
        timeoutMs: 10_000,
      });
      expect(result.status).toBe("SKIPPED");
      expect(result.errors[0]?.code).toBe("not_configured");
    } finally {
      if (originalPath) process.env.TRIVY_BINARY_PATH = originalPath;
    }
  });
});
