import { beforeEach, describe, expect, it } from "vitest";
import { osvSbomRule } from "../rules/osv-sbom-rule";
import { OSV_SBOM_RULE_ID } from "../osv/enrich-sbom";
import { resetDependencyProcessCachesForTests } from "../shared/dependency-process-cache";

// See osv-enrich-sbom.test.ts -- same cross-test isolation reasoning.
beforeEach(() => {
  resetDependencyProcessCachesForTests();
});

const PACKAGE_LOCK = JSON.stringify(
  {
    name: "demo-app",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        dependencies: { lodash: "4.17.20" },
      },
      "node_modules/lodash": { version: "4.17.20" },
    },
  },
  null,
  2
);

describe("osv sbom scan rule", () => {
  it("registers with the expected rule id", () => {
    expect(osvSbomRule.id).toBe(OSV_SBOM_RULE_ID);
  });

  it("returns FindingDraft objects through the existing pipeline", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          results: [
            {
              vulns: [
                {
                  id: "GHSA-xxxx-yyyy-zzzz",
                  aliases: ["CVE-2021-23337"],
                  summary: "Prototype Pollution in lodash",
                  severity: [{ type: "CVSS_V3", score: 7.5 }],
                  affected: [
                    {
                      package: { name: "lodash" },
                      ranges: [{ events: [{ fixed: "4.17.21" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      }) as Response;

    try {
      const drafts = await osvSbomRule.run({
        files: [
          {
            path: "package-lock.json",
            content: PACKAGE_LOCK,
            extension: "json",
            lines: PACKAGE_LOCK.split("\n"),
            bytes: PACKAGE_LOCK.length,
          },
        ],
        stack: {
          languages: ["javascript"],
          frameworks: ["node"],
          services: [],
          packageManagers: ["npm"],
          dependencies: {},
        },
        getFile: (path) =>
          path === "package-lock.json"
            ? {
                path,
                content: PACKAGE_LOCK,
                extension: "json",
                lines: PACKAGE_LOCK.split("\n"),
                bytes: PACKAGE_LOCK.length,
              }
            : undefined,
      });

      expect(drafts.length).toBeGreaterThan(0);
      expect(drafts[0]?.ruleId).toBe("agent-scanner.osv.dependency-vulnerability");
      expect(drafts[0]?.category).toBe("supply-chain");
      expect(drafts[0]?.metadata?.securityAnalysis).toMatchObject({
        sourceTool: "osv",
        verificationStatus: "LIKELY",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("L1.5: throws (rather than silently returning an empty array) when OSV is unavailable", async () => {
    // Previous behavior: this rule swallowed analyzeOsvSbomEvidence's own
    // internal osvError and returned an empty findings array -- making a
    // real OSV outage indistinguishable from "no vulnerable dependencies,"
    // in both the local and cloud paths (this file is shared, unchanged
    // elsewhere). New behavior: the rule re-throws, which
    // scanRepository()'s existing per-rule failure tracking already turns
    // into a recorded omission (reason: "rule-error") instead of a silent
    // false negative -- reusing that existing mechanism, not a new one.
    // False-negative impact of the OLD behavior: a developer offline or
    // hitting a rate-limited/degraded OSV endpoint would have seen "no
    // dependency vulnerabilities found" with no indication the check
    // never actually ran.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 503,
      }) as Response;

    try {
      await expect(
        osvSbomRule.run({
          files: [
            {
              path: "package-lock.json",
              content: PACKAGE_LOCK,
              extension: "json",
              lines: PACKAGE_LOCK.split("\n"),
              bytes: PACKAGE_LOCK.length,
            },
          ],
          stack: {
            languages: ["javascript"],
            frameworks: ["node"],
            services: [],
            packageManagers: ["npm"],
            dependencies: {},
          },
          getFile: (path) =>
            path === "package-lock.json"
              ? {
                  path,
                  content: PACKAGE_LOCK,
                  extension: "json",
                  lines: PACKAGE_LOCK.split("\n"),
                  bytes: PACKAGE_LOCK.length,
                }
              : undefined,
        })
      ).rejects.toThrow(/OSV dependency check failed/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
