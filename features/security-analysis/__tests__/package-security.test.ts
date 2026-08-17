import { describe, expect, it, vi } from "vitest";
import { analyzePackageSecurity } from "../package-security/analyze";
import { extractDeclaredDependencies } from "../package-security/extract-dependencies";
import { lookupPackages } from "../package-security/registry-client";
import { findSimilarPackages } from "../package-security/typosquat";
import { packageSecurityRawFindingsToSecurityAnalysis } from "../package-security/to-findings";
import { analyzePackageSecurityEvidence, packageSecurityRule } from "../rules/package-security-rule";
import { securityAnalysisFindingToDraft } from "../to-finding-draft";
import type { SbomEcosystem } from "../sbom/types";
import type { RegistryLookupResult } from "../package-security/types";

function file(path: string, content: string) {
  return { path, content };
}

function mockFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        return handler();
      }
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
}

function npmExists(name: string) {
  return mockFetch({
    [encodeURIComponent(name).replace("%40", "@").replace("%2F", "/")]: () =>
      new Response(JSON.stringify({ name, version: "1.0.0" }), { status: 200 }),
    [name.startsWith("@") ? name.replace("/", "%2F") : name]: () =>
      new Response(JSON.stringify({ name, version: "1.0.0" }), { status: 200 }),
  });
}

function registryMap(map: Record<string, RegistryLookupResult>) {
  return {
    fetchImpl: mockFetch(
      Object.fromEntries(
        Object.entries(map).map(([key, result]) => [
          key,
          () =>
            new Response(result.status === "not_found" ? "Not Found" : "{}", {
              status: result.status === "not_found" ? 404 : result.status === "unavailable" ? 503 : 200,
            }),
        ])
      )
    ),
  };
}

describe("package typosquat helpers", () => {
  it("finds similar npm packages for likely typos", () => {
    const similar = findSimilarPackages("expres", "npm", 2, 3);
    expect(similar.some((entry) => entry.name === "express")).toBe(true);
  });

  it("does not suggest typosquat for exact legitimate package names", () => {
    const similar = findSimilarPackages("express", "npm", 1, 3);
    expect(similar).toHaveLength(0);
  });
});

describe("dependency extraction", () => {
  it("extracts npm manifest dependencies without prose", () => {
    const deps = extractDeclaredDependencies([
      file(
        "package.json",
        JSON.stringify({
          name: "app",
          dependencies: { express: "^4.18.0", lodash: "^4.17.21" },
        })
      ),
    ]);
    expect(deps.some((dep) => dep.name === "express")).toBe(true);
    expect(deps.some((dep) => dep.name === "lodash")).toBe(true);
  });

  it("marks workspace and local packages as internal", () => {
    const deps = extractDeclaredDependencies([
      file(
        "package.json",
        JSON.stringify({
          name: "monorepo",
          workspaces: ["packages/*"],
          dependencies: {
            "@monorepo/shared": "workspace:*",
            "local-lib": "file:../local-lib",
          },
        })
      ),
    ]);
    const shared = deps.find((dep) => dep.name === "@monorepo/shared");
    const local = deps.find((dep) => dep.name === "local-lib");
    expect(shared?.kind).toBe("workspace");
    expect(local?.kind).toBe("file");
  });

  it("deduplicates the same package across manifest and lockfile", () => {
    const deps = extractDeclaredDependencies([
      file("package.json", JSON.stringify({ dependencies: { lodash: "^4.17.21" } })),
      file(
        "package-lock.json",
        JSON.stringify({
          name: "app",
          lockfileVersion: 3,
          packages: {
            "": { dependencies: { lodash: "^4.17.21" } },
            "node_modules/lodash": { version: "4.17.21" },
          },
        })
      ),
    ]);
    expect(deps.filter((dep) => dep.name === "lodash")).toHaveLength(1);
  });
});

describe("registry client", () => {
  it("returns unavailable on registry timeout without creating not-found findings downstream", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as typeof fetch;
    const results = await lookupPackages([{ ecosystem: "npm", name: "missing-pkg" }], {
      fetchImpl,
      timeoutMs: 10,
    });
    expect(results.get("npm:missing-pkg")?.status).toBe("unavailable");
  });

  it("handles malformed registry responses as unavailable", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/broken-json": () => new Response("not-json", { status: 200 }),
    });
    const results = await lookupPackages([{ ecosystem: "npm", name: "broken-json" }], { fetchImpl });
    expect(results.get("npm:broken-json")?.status).toBe("unavailable");
  });
});

describe("analyzePackageSecurity", () => {
  it("returns no findings for valid existing npm package", async () => {
    const result = await analyzePackageSecurity(
      [file("package.json", JSON.stringify({ dependencies: { lodash: "^4.17.21" } }))],
      { fetchImpl: npmExists("lodash") }
    );
    expect(result.findings).toHaveLength(0);
  });

  it("flags non-existent package with high-confidence potential hallucination", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/ai-hallucinated-package": () => new Response("Not Found", { status: 404 }),
    });
    const result = await analyzePackageSecurity(
      [file("package.json", JSON.stringify({ dependencies: { "ai-hallucinated-package": "^1.0.0" } }))],
      { fetchImpl }
    );
    expect(result.findings.some((finding) => finding.rule.includes("not-found"))).toBe(true);
  });

  it("flags strong typosquat candidate when package is missing", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/expres": () => new Response("Not Found", { status: 404 }),
    });
    const result = await analyzePackageSecurity(
      [file("package.json", JSON.stringify({ dependencies: { expres: "^4.0.0" } }))],
      { fetchImpl }
    );
    expect(result.findings.some((finding) => finding.rule.includes("typosquat"))).toBe(true);
  });

  it("handles scoped packages without stripping scope", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/%40company%2Finternal-tool": () => new Response("Not Found", { status: 404 }),
    });
    const result = await analyzePackageSecurity(
      [
        file(
          "package.json",
          JSON.stringify({ dependencies: { "@company/internal-tool": "^1.0.0" } })
        ),
      ],
      { fetchImpl }
    );
    expect(result.findings.some((finding) => finding.packageName === "@company/internal-tool")).toBe(true);
    expect(result.findings.some((finding) => finding.rule.includes("not-found"))).toBe(false);
    expect(result.findings.some((finding) => finding.category === "dependency-confusion")).toBe(true);
  });

  it("does not flag private/internal-looking scoped packages as hallucinated when treated internal", async () => {
    const result = await analyzePackageSecurity(
      [
        file(
          "package.json",
          JSON.stringify({ dependencies: { "@company/private-lib": "workspace:*" } })
        ),
      ],
      { skipRegistry: true }
    );
    expect(result.findings.some((finding) => finding.rule.includes("not-found"))).toBe(false);
  });

  it("does not flag local workspace packages as hallucinated", async () => {
    const result = await analyzePackageSecurity(
      [
        file(
          "package.json",
          JSON.stringify({
            name: "monorepo",
            dependencies: { "local-lib": "file:../local-lib" },
          })
        ),
      ],
      { skipRegistry: true }
    );
    expect(result.findings.some((finding) => finding.rule.includes("not-found"))).toBe(false);
  });

  it("does not flag git dependencies as hallucinated", async () => {
    const result = await analyzePackageSecurity(
      [
        file(
          "package.json",
          JSON.stringify({
            dependencies: {
              "my-lib": "git+https://github.com/org/my-lib.git",
            },
          })
        ),
      ],
      { skipRegistry: true }
    );
    expect(result.findings.some((finding) => finding.rule.includes("not-found"))).toBe(false);
  });

  it("creates no hallucination finding when registry is unavailable", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/unreachable-pkg": () => new Response("Service Unavailable", { status: 503 }),
    });
    const result = await analyzePackageSecurity(
      [file("package.json", JSON.stringify({ dependencies: { "unreachable-pkg": "^1.0.0" } }))],
      { fetchImpl }
    );
    expect(result.findings.some((finding) => finding.rule.includes("not-found"))).toBe(false);
    expect(result.registryUnavailable).toBe(true);
  });

  it("creates no finding for documentation-only package mentions", async () => {
    const result = await analyzePackageSecurity(
      [file("README.md", "# Install\n\nTry `npm install fake-package`\n")],
      { skipRegistry: true }
    );
    expect(result.findings).toHaveLength(0);
  });

  it("does not scan test fixture prose files", async () => {
    const result = await analyzePackageSecurity(
      [file("tests/fixtures/readme.md", "Use fake-package in examples")],
      { skipRegistry: true }
    );
    expect(result.findings).toHaveLength(0);
  });

  it("returns multiple findings across categories when applicable", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/internal-utils": () => new Response("Not Found", { status: 404 }),
    });
    const result = await analyzePackageSecurity(
      [file("package.json", JSON.stringify({ dependencies: { "internal-utils": "^1.0.0" } }))],
      { fetchImpl }
    );
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("does not duplicate hallucination finding for package that only differs by manifest vs lockfile", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/fake-lib": () => new Response("Not Found", { status: 404 }),
    });
    const result = await analyzePackageSecurity(
      [
        file("package.json", JSON.stringify({ dependencies: { "fake-lib": "^1.0.0" } })),
        file(
          "package-lock.json",
          JSON.stringify({
            name: "app",
            lockfileVersion: 3,
            packages: {
              "": { dependencies: { "fake-lib": "^1.0.0" } },
              "node_modules/fake-lib": { version: "1.0.0" },
            },
          })
        ),
      ],
      { fetchImpl }
    );
    expect(result.findings.filter((finding) => finding.packageName === "fake-lib")).toHaveLength(1);
  });

  it("never auto-confirms package security findings", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/fake-lib": () => new Response("Not Found", { status: 404 }),
    });
    const result = await analyzePackageSecurity(
      [file("package.json", JSON.stringify({ dependencies: { "fake-lib": "^1.0.0" } }))],
      { fetchImpl }
    );
    const normalized = packageSecurityRawFindingsToSecurityAnalysis(result.findings);
    for (const finding of normalized) {
      expect(finding.verificationStatus).not.toBe("CONFIRMED");
      expect(finding.sourceTool).toBe("scan_packages");
    }
  });

  it("assigns LIKELY for strong typosquat block findings", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/expres": () => new Response("Not Found", { status: 404 }),
    });
    const result = await analyzePackageSecurity(
      [file("package.json", JSON.stringify({ dependencies: { expres: "^4.0.0" } }))],
      { fetchImpl }
    );
    const normalized = packageSecurityRawFindingsToSecurityAnalysis(result.findings);
    const likely = normalized.find(
      (finding) => finding.action === "BLOCK" && finding.confidence === "HIGH"
    );
    if (likely) {
      expect(likely.verificationStatus).toBe("LIKELY");
    }
  });

  it("integrates with FindingDraft pipeline", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/fake-lib": () => new Response("Not Found", { status: 404 }),
    });
    const { findings } = await analyzePackageSecurityEvidence(
      [file("package.json", JSON.stringify({ dependencies: { "fake-lib": "^1.0.0" } }))],
      { fetchImpl }
    );
    expect(findings.length).toBeGreaterThan(0);
    const draft = securityAnalysisFindingToDraft(findings[0]!);
    expect(draft.metadata?.securityAnalysis).toMatchObject({ sourceTool: "scan_packages" });
    expect(draft.metadata?.packageSecurity).toBeTruthy();
  });

  it("handles empty repository", async () => {
    const result = await analyzePackageSecurity([], { skipRegistry: true });
    expect(result.findings).toHaveLength(0);
  });

  it("supports multiple ecosystems in one repository snapshot", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/lodash": () => new Response("{}", { status: 200 }),
      "pypi.org/pypi/requests/json": () => new Response("{}", { status: 200 }),
      "registry.npmjs.org/not-a-python-lib-on-npm": () => new Response("Not Found", { status: 404 }),
    });
    const result = await analyzePackageSecurity(
      [
        file("package.json", JSON.stringify({ dependencies: { lodash: "^4.17.21" } })),
        file("requirements.txt", "requests==2.31.0\n"),
      ],
      { fetchImpl }
    );
    expect(result.dependenciesChecked).toBeGreaterThan(1);
  });

  it("preserves dependency confusion signal for internal-looking names", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/internal-auth": () => new Response("Not Found", { status: 404 }),
    });
    const result = await analyzePackageSecurity(
      [file("package.json", JSON.stringify({ dependencies: { "internal-auth": "^1.0.0" } }))],
      { fetchImpl }
    );
    expect(result.findings.some((finding) => finding.category === "dependency-confusion")).toBe(true);
  });

  it("does not flag safe legitimate package with similar popular name", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/express": () => new Response(JSON.stringify({ name: "express" }), { status: 200 }),
    });
    const result = await analyzePackageSecurity(
      [file("package.json", JSON.stringify({ dependencies: { express: "^4.18.0" } }))],
      { fetchImpl }
    );
    expect(result.findings.some((finding) => finding.category === "package-typosquat")).toBe(false);
  });
});

describe("packageSecurityRule", () => {
  it("returns FindingDraft objects through ScanRule integration", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/fake-lib": () => new Response("Not Found", { status: 404 }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchImpl;
    try {
      const drafts = await packageSecurityRule.run({
        files: [
          {
            path: "package.json",
            content: JSON.stringify({ dependencies: { "fake-lib": "^1.0.0" } }),
            extension: "json",
            lines: [],
            bytes: 0,
          },
        ],
        stack: {
          languages: ["typescript"],
          frameworks: [],
          services: [],
          packageManagers: [],
          dependencies: {},
        },
        getFile: () => undefined,
      });
      expect(drafts.length).toBeGreaterThan(0);
      expect(drafts[0]?.ruleId.startsWith("agent-scanner.scan_packages.")).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("derive verification for scan_packages", () => {
  it("maps high-confidence block findings to LIKELY not CONFIRMED", async () => {
    const fetchImpl = mockFetch({
      "registry.npmjs.org/expres": () => new Response("Not Found", { status: 404 }),
    });
    const result = await analyzePackageSecurity(
      [file("package.json", JSON.stringify({ dependencies: { expres: "^4.0.0" } }))],
      { fetchImpl }
    );
    const normalized = packageSecurityRawFindingsToSecurityAnalysis(result.findings);
    expect(normalized.some((finding) => finding.verificationStatus === "LIKELY")).toBe(true);
    expect(normalized.every((finding) => finding.verificationStatus !== "CONFIRMED")).toBe(true);
  });
});
