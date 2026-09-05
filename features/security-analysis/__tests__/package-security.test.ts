import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzePackageSecurity } from "../package-security/analyze";
import { extractDeclaredDependencies } from "../package-security/extract-dependencies";
import { lookupPackages } from "../package-security/registry-client";
import { findSimilarPackages } from "../package-security/typosquat";
import { packageSecurityRawFindingsToSecurityAnalysis } from "../package-security/to-findings";
import { analyzePackageSecurityEvidence, packageSecurityRule } from "../rules/package-security-rule";
import { securityAnalysisFindingToDraft } from "../to-finding-draft";
import type { SbomEcosystem } from "../sbom/types";
import type { RegistryLookupResult } from "../package-security/types";
import { resetDependencyProcessCachesForTests } from "../shared/dependency-process-cache";
import { REGISTRY_LOOKUP_CONCURRENCY } from "../package-security/constants";

// Phase 15's cross-scan process cache is module-scoped by design. Reset it
// before each test so one test's registry result can't leak into another's
// via a stale cache hit.
beforeEach(() => {
  resetDependencyProcessCachesForTests();
});

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

  it("handles malformed registry responses as unavailable (GET-based ecosystem: crates.io)", async () => {
    // npm/pypi/rubygems now use HEAD (Phase 17) and never read a body, so
    // this scenario is only meaningful for the ecosystems still on GET.
    const fetchImpl = mockFetch({
      "crates.io/api/v1/crates/broken-json": () => new Response("not-json", { status: 200 }),
    });
    const results = await lookupPackages([{ ecosystem: "crates", name: "broken-json" }], { fetchImpl });
    expect(results.get("crates:broken-json")?.status).toBe("unavailable");
  });

  it("Phase 17: HEAD-based ecosystems (npm) never inspect the body -- a garbage body on 200 still means 'exists'", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("HEAD");
      return new Response("this body would be malformed JSON if it were ever read", { status: 200 });
    }) as unknown as typeof fetch;
    const results = await lookupPackages([{ ecosystem: "npm", name: "left-pad" }], { fetchImpl });
    expect(results.get("npm:left-pad")?.status).toBe("exists");
  });

  it("Phase 17: crates.io stays on GET -- a 403 (matching its real HEAD behavior for existing packages) is 'unavailable', never 'not_found'", async () => {
    const fetchImpl = mockFetch({
      "crates.io/api/v1/crates/serde": () => new Response("Forbidden", { status: 403 }),
    });
    const results = await lookupPackages([{ ecosystem: "crates", name: "serde" }], { fetchImpl });
    expect(results.get("crates:serde")?.status).toBe("unavailable");
    expect(results.get("crates:serde")?.status).not.toBe("not_found");
  });

  it("Phase 17: pypi and rubygems also use HEAD", async () => {
    const seenMethods: Record<string, string> = {};
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("pypi.org")) seenMethods.pypi = init?.method ?? "GET";
      if (url.includes("rubygems.org")) seenMethods.rubygems = init?.method ?? "GET";
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await lookupPackages(
      [
        { ecosystem: "pypi", name: "requests" },
        { ecosystem: "rubygems", name: "rails" },
      ],
      { fetchImpl }
    );
    expect(seenMethods.pypi).toBe("HEAD");
    expect(seenMethods.rubygems).toBe("HEAD");
  });

  it("Phase 17: go stays on GET (body-dependent existence check unchanged)", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      return new Response("v1.0.0\nv1.1.0", { status: 200 });
    }) as unknown as typeof fetch;
    const results = await lookupPackages(
      [{ ecosystem: "go", name: "github.com/gin-gonic/gin" }],
      { fetchImpl }
    );
    expect(results.get("go:github.com/gin-gonic/gin")?.status).toBe("exists");
  });
});

describe("Phase 18A -- registry client sends a descriptive User-Agent (crates.io reliability fix)", () => {
  it("sends User-Agent on every request, every ecosystem -- not just crates.io", async () => {
    const seenUserAgents: string[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      seenUserAgents.push(headers?.["User-Agent"] ?? "");
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    await lookupPackages(
      [
        { ecosystem: "npm", name: "left-pad" },
        { ecosystem: "crates", name: "serde" },
        { ecosystem: "go", name: "github.com/gin-gonic/gin" },
      ],
      { fetchImpl }
    );

    expect(seenUserAgents).toHaveLength(3);
    expect(seenUserAgents.every((ua) => ua === "SequrAI-Scanner/1.0")).toBe(true);
  });

  it("crates.io: 200 existing package -> exists", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)?.["User-Agent"]).toBeTruthy();
      return new Response(JSON.stringify({ crate: { name: "serde" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const results = await lookupPackages([{ ecosystem: "crates", name: "serde" }], { fetchImpl });
    expect(results.get("crates:serde")?.status).toBe("exists");
  });

  it("crates.io: 404 nonexistent package -> not_found", async () => {
    const fetchImpl = vi.fn(async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;
    const results = await lookupPackages(
      [{ ecosystem: "crates", name: "this-crate-does-not-exist-xyz" }],
      { fetchImpl }
    );
    expect(results.get("crates:this-crate-does-not-exist-xyz")?.status).toBe("not_found");
  });

  it("crates.io: 403 -> unavailable, NEVER not_found (the exact failure mode the User-Agent fix addresses)", async () => {
    const fetchImpl = vi.fn(async () => new Response("Forbidden", { status: 403 })) as unknown as typeof fetch;
    const results = await lookupPackages([{ ecosystem: "crates", name: "serde" }], { fetchImpl });
    expect(results.get("crates:serde")?.status).toBe("unavailable");
    expect(results.get("crates:serde")?.status).not.toBe("not_found");
  });

  it("crates.io: 429 -> unavailable, not retried (unchanged semantics)", async () => {
    const fetchImpl = vi.fn(async () => new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    const results = await lookupPackages([{ ecosystem: "crates", name: "serde" }], { fetchImpl });
    expect(results.get("crates:serde")?.status).toBe("unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("crates.io: 500 -> unavailable, not retried (unchanged semantics)", async () => {
    const fetchImpl = vi.fn(async () => new Response("Internal Server Error", { status: 500 })) as unknown as typeof fetch;
    const results = await lookupPackages([{ ecosystem: "crates", name: "serde" }], { fetchImpl });
    expect(results.get("crates:serde")?.status).toBe("unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("crates.io: timeout -> retried once, then unavailable (unchanged semantics)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    const results = await lookupPackages([{ ecosystem: "crates", name: "serde" }], { fetchImpl, timeoutMs: 10 });
    expect(results.get("crates:serde")?.status).toBe("unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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

describe("Phase 15 -- cross-scan dependency-intelligence cache", () => {
  it("a second, independent scan for the same package makes zero network requests (cache hit)", async () => {
    const fetchImpl = npmExists("left-pad") as unknown as ReturnType<typeof vi.fn>;
    const firstScanFiles = [
      file("package.json", JSON.stringify({ dependencies: { "left-pad": "^1.3.0" } })),
    ];

    const first = await analyzePackageSecurity(firstScanFiles, { fetchImpl });
    expect(first.registryUnavailable).toBe(false);
    const callsAfterFirstScan = fetchImpl.mock.calls.length;
    expect(callsAfterFirstScan).toBeGreaterThan(0);

    // A second, entirely independent call -- simulating a different scan
    // (a rescan, or a different project) -- with its own fresh fetchImpl
    // spy carrying no mock data of its own, to prove the result did NOT
    // come from a fresh network call this time.
    const secondFetchImpl = vi.fn(async () => {
      throw new Error("must not be called -- this dependency should be served from the cross-scan cache");
    });
    const second = await analyzePackageSecurity(firstScanFiles, { fetchImpl: secondFetchImpl });

    expect(secondFetchImpl).not.toHaveBeenCalled();
    expect(second.registryUnavailable).toBe(false);
    // Deterministic output unchanged: same findings either way (none, since left-pad exists).
    expect(second.findings).toEqual(first.findings);
  });

  it("a failed lookup is never cached cross-scan -- the next scan genuinely retries", async () => {
    const failingFetch = vi.fn(async () => new Response("boom", { status: 503 }));
    const firstScanFiles = [
      file("package.json", JSON.stringify({ dependencies: { "some-flaky-pkg": "^1.0.0" } })),
    ];

    const first = await analyzePackageSecurity(firstScanFiles, { fetchImpl: failingFetch });
    expect(first.registryUnavailable).toBe(true);

    const secondFetch = vi.fn(async () => new Response("boom", { status: 503 }));
    await analyzePackageSecurity(firstScanFiles, { fetchImpl: secondFetch });

    // If the outage result had been cached cross-scan, this would be 0.
    expect(secondFetch).toHaveBeenCalled();
  });

  it(
    "Phase 17H: the cross-scan cache does not distinguish a HEAD-origin result from a GET-origin one -- " +
      "a package resolved via npm's HEAD strategy warms the cache exactly like any other ecosystem",
    async () => {
      const headFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBe("HEAD");
        return new Response(null, { status: 200 });
      }) as unknown as ReturnType<typeof vi.fn>;

      const files = [file("package.json", JSON.stringify({ dependencies: { "left-pad": "^1.3.0" } }))];
      const first = await analyzePackageSecurity(files, { fetchImpl: headFetch as unknown as typeof fetch });
      expect(first.registryUnavailable).toBe(false);
      expect(headFetch).toHaveBeenCalled();

      // Second, independent scan -- no fetchImpl provided data, proving the
      // cache (populated by the HEAD-based lookup above) satisfies it without
      // caring that the original result came from HEAD, not GET.
      const secondFetch = vi.fn(async () => {
        throw new Error("must not be called -- should be served from the cross-scan cache");
      });
      const second = await analyzePackageSecurity(files, { fetchImpl: secondFetch });
      expect(secondFetch).not.toHaveBeenCalled();
      expect(second.findings).toEqual(first.findings);
    }
  );
});

describe("Phase 18E (Option F) -- in-flight registry request coalescing", () => {
  it("two truly concurrent scans requesting the same never-before-seen package share one real request", async () => {
    let requestCount = 0;
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchImpl = vi.fn(async () => {
      requestCount += 1;
      // Deliberately never resolves until both scans have already started
      // their lookup for the same key, proving the second one didn't fire
      // its own request while the first was still pending.
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as unknown as typeof fetch;

    const files = [file("package.json", JSON.stringify({ dependencies: { "coalesce-pkg": "^1.0.0" } }))];

    const scanA = analyzePackageSecurity(files, { fetchImpl });
    // Give scanA's request a tick to actually start (register itself as in-flight).
    await new Promise((resolve) => setTimeout(resolve, 5));
    const scanB = analyzePackageSecurity(files, { fetchImpl });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(requestCount).toBe(1); // NOT 2 -- scanB coalesced onto scanA's in-flight request

    resolveFetch!(new Response(null, { status: 200 }));
    const [resultA, resultB] = await Promise.all([scanA, scanB]);
    expect(resultA.registryUnavailable).toBe(false);
    expect(resultB.registryUnavailable).toBe(false);
    expect(resultA.findings).toEqual(resultB.findings);
  });

  it("cleans up after completion -- a later, non-overlapping scan fetches fresh rather than reusing a stale in-flight promise", async () => {
    const files = [file("package.json", JSON.stringify({ dependencies: { "coalesce-pkg-2": "^1.0.0" } }))];

    const firstFetch = vi.fn(async () => new Response(null, { status: 200 }));
    await analyzePackageSecurity(files, { fetchImpl: firstFetch });
    expect(firstFetch).toHaveBeenCalledTimes(1);

    // Not concurrent -- runs fully after the first completes. Would only
    // avoid a real request if served by the (separate, TTL-based) Phase 15
    // cache, which is expected and fine; the point of THIS test is that the
    // in-flight map itself doesn't leak a stale entry forever.
    const { dependencyProcessCacheSizesForTests } = await import("../shared/dependency-process-cache");
    expect(dependencyProcessCacheSizesForTests().inFlight).toBe(0);
  });

  it("coalescing does not change the resolved result's shape or content vs an uncoalesced call", async () => {
    const fetchImpl = npmExists("left-pad");
    const files = [file("package.json", JSON.stringify({ dependencies: { "left-pad": "^1.3.0" } }))];
    const result = await analyzePackageSecurity(files, { fetchImpl });
    expect(result.findings).toEqual([]);
    expect(result.registryUnavailable).toBe(false);
  });
});

describe("Phase 19I -- the bounded queue does not break request coalescing", () => {
  it("three concurrent scans requesting the same package under the queue scheduler still produce exactly one real request", async () => {
    let requestCount = 0;
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchImpl = vi.fn(async () => {
      requestCount += 1;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as unknown as typeof fetch;

    const files = [file("package.json", JSON.stringify({ dependencies: { "queue-coalesce-pkg": "^1.0.0" } }))];

    const scanA = analyzePackageSecurity(files, { fetchImpl });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const scanB = analyzePackageSecurity(files, { fetchImpl });
    const scanC = analyzePackageSecurity(files, { fetchImpl });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(requestCount).toBe(1); // still 1, not 3 -- the queue's worker-pull scheduling doesn't bypass coalescing

    resolveFetch!(new Response(null, { status: 200 }));
    const [a, b, c] = await Promise.all([scanA, scanB, scanC]);
    expect(a.findings).toEqual(b.findings);
    expect(b.findings).toEqual(c.findings);
  });
});

describe("Phase 19G -- bounded queue preserves peak concurrency and per-item semantics", () => {
  it("never has more than `concurrency` requests in flight at once, even with mixed fast/slow responses", async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      active += 1;
      peak = Math.max(peak, active);
      const url = String(input);
      // Deterministic mixed latency by package index parity, not Math.random.
      const isSlow = /pkg-(\d+)/.exec(url)?.[1] != null && Number(/pkg-(\d+)/.exec(url)![1]) % 5 === 0;
      await new Promise((resolve) => setTimeout(resolve, isSlow ? 40 : 5));
      active -= 1;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const dependencies: Record<string, string> = {};
    for (let i = 0; i < 40; i++) dependencies[`pkg-${i}`] = "^1.0.0";
    const files = [file("package.json", JSON.stringify({ dependencies }))];

    await analyzePackageSecurity(files, { fetchImpl });
    expect(peak).toBeLessThanOrEqual(REGISTRY_LOOKUP_CONCURRENCY);
  });

  it("preserves exact per-item results regardless of completion order (fast items finishing before slow ones started earlier)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("slow-first")) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return new Response(null, { status: 200 }); // exists
      }
      if (url.includes("fast-second")) {
        return new Response("Not Found", { status: 404 }); // not_found, resolves first
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const files = [
      file(
        "package.json",
        JSON.stringify({ dependencies: { "slow-first": "^1.0.0", "fast-second": "^1.0.0" } })
      ),
    ];
    const result = await analyzePackageSecurity(files, { fetchImpl });
    // fast-second resolves to not_found -> a hallucination finding; slow-first exists -> no finding for it.
    expect(result.findings.some((f) => f.packageName === "fast-second")).toBe(true);
    expect(result.findings.some((f) => f.packageName === "slow-first")).toBe(false);
  });
});

describe("Phase 20 -- verification-minimization investigation: no unsafe reduction", () => {
  it(
    "SECURITY: a private-looking scoped package (heuristic only, NOT workspace-kind) still triggers a real " +
      "registry call -- proactively skipping it would lose dependency-confusion detection if it unexpectedly " +
      "resolves publicly. Investigated in Phase 20, deliberately NOT optimized away.",
    async () => {
      const fetchImpl = vi.fn(async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;
      // A real semver range (not workspace:*/file:/git:) under an unrecognized
      // private-looking scope -- isLikelyPrivatePackage() would say "likely
      // private" from name/scope alone, with zero network access needed.
      const files = [
        file("package.json", JSON.stringify({ dependencies: { "@acme-internal/widgets": "^1.0.0" } })),
      ];
      const result = await analyzePackageSecurity(files, { fetchImpl });
      expect(fetchImpl).toHaveBeenCalled(); // the lookup still happens
      expect(result.registryLookups).toBe(1);
      // But no hallucination FINDING is raised for it, since not_found is expected for a private package.
      expect(result.findings.some((f) => f.packageName === "@acme-internal/widgets")).toBe(false);
    }
  );

  it("devDependencies still trigger registry verification (build/CI/test-time execution risk, per Phase 20I)", async () => {
    const fetchImpl = vi.fn(async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;
    const files = [
      file("package.json", JSON.stringify({ devDependencies: { "hallucinated-dev-tool": "^1.0.0" } })),
    ];
    const result = await analyzePackageSecurity(files, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalled();
    expect(result.findings.some((f) => f.packageName === "hallucinated-dev-tool")).toBe(true);
  });

  it("attacker Scenario C: a lockfile cannot fabricate a package into existing -- lockfile-declared names still go through the real registry check", async () => {
    const packageLock = JSON.stringify({
      name: "demo",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { "attacker-fabricated-in-lockfile": "1.0.0" } },
        "node_modules/attacker-fabricated-in-lockfile": { version: "1.0.0" },
      },
    });
    const fetchImpl = vi.fn(async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;
    const files = [
      file("package.json", JSON.stringify({ dependencies: { "attacker-fabricated-in-lockfile": "^1.0.0" } })),
      file("package-lock.json", packageLock),
    ];
    const result = await analyzePackageSecurity(files, { fetchImpl });
    // The lockfile claiming this package "resolved successfully" does NOT
    // substitute for a real registry check -- it's still flagged.
    expect(result.findings.some((f) => f.packageName === "attacker-fabricated-in-lockfile")).toBe(true);
  });
});

describe("Phase 21M -- a cache hit bypasses the scheduler and process cap entirely", () => {
  it("a warm (cross-scan cached) lookup makes zero network calls, proving it never occupies a registry worker or process slot", async () => {
    const files = [file("package.json", JSON.stringify({ dependencies: { "warm-cache-pkg": "^1.0.0" } }))];
    const firstFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const first = await analyzePackageSecurity(files, { fetchImpl: firstFetch });
    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(first.registryUnavailable).toBe(false);

    // Second call: no fetchImpl data provided at all -- if this call ever
    // reached the network/scheduler/semaphore layer, it would throw.
    const secondFetch = vi.fn(async () => {
      throw new Error("must not be called -- warm cache hit should short-circuit before any worker/slot is touched");
    });
    const second = await analyzePackageSecurity(files, { fetchImpl: secondFetch });
    expect(secondFetch).not.toHaveBeenCalled();
    expect(second.findings).toEqual(first.findings);
  });
});

describe("Phase 22.11 -- instrumentation cannot alter scanner behavior or leak into security decisions", () => {
  it("a throwing onLookupTiming callback does not break the scan or change its findings", async () => {
    const files = [
      file(
        "package.json",
        JSON.stringify({ dependencies: { "ai-hallucinated-instrumentation-test": "^1.0.0" } })
      ),
    ];
    const fetchImpl = vi.fn(async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;

    const baseline = await analyzePackageSecurity(files, { fetchImpl });

    // Reset the cache so the second call performs a real lookup again --
    // otherwise the (promotable) not_found result from the first call would
    // serve this one from cache, and onLookupTiming would never fire at all,
    // defeating the point of this test.
    resetDependencyProcessCachesForTests();
    const withThrowingCallback = await analyzePackageSecurity(files, {
      fetchImpl,
      onLookupTiming: () => {
        throw new Error("instrumentation consumer bug -- must not affect scanning");
      },
      onCoalesced: () => {
        throw new Error("instrumentation consumer bug -- must not affect scanning");
      },
    });

    expect(withThrowingCallback.findings).toEqual(baseline.findings);
    expect(withThrowingCallback.registryUnavailable).toBe(baseline.registryUnavailable);
  });

  it("findings are identical across different per-scan concurrency settings (4 vs 12 vs 24)", async () => {
    const dependencies: Record<string, string> = {};
    for (let i = 0; i < 30; i++) dependencies[`concurrency-test-pkg-${i}`] = "^1.0.0";
    // Every 4th package "doesn't exist" -- exercises hallucination findings too, not just exists.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = /concurrency-test-pkg-(\d+)/.exec(url);
      const isMissing = match && Number(match[1]) % 4 === 0;
      return new Response(isMissing ? "Not Found" : null, { status: isMissing ? 404 : 200 });
    }) as unknown as typeof fetch;
    const files = [file("package.json", JSON.stringify({ dependencies }))];

    const results = await Promise.all(
      [4, 12, 24].map((concurrency) => {
        resetDependencyProcessCachesForTests();
        return analyzePackageSecurity(files, { fetchImpl, concurrency });
      })
    );

    const [r4, r12, r24] = results;
    const normalize = (r: (typeof results)[number]) =>
      [...r.findings].sort((a, b) => a.packageName.localeCompare(b.packageName));
    expect(normalize(r12)).toEqual(normalize(r4));
    expect(normalize(r24)).toEqual(normalize(r4));
  });
});
