import { describe, expect, it } from "vitest";
import { queryOsvBatch, componentsToOsvPackages } from "../osv/client";
import { mapOsvVulnerability } from "../osv/map-vulnerability";
import { OsvQueryError } from "../osv/types";
import { createSbomComponent } from "../sbom/component";

describe("osv client", () => {
  it("sends only package name, version, and ecosystem to OSV", async () => {
    let capturedBody: { queries: Array<{ package: { name: string; ecosystem: string }; version: string }> } | null =
      null;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({ results: [{ vulns: [] }] }),
      } as Response;
    };

    await queryOsvBatch(
      [{ name: "lodash", version: "4.17.20", ecosystem: "npm", purl: "pkg:npm/lodash@4.17.20" }],
      { fetchImpl }
    );

    expect(capturedBody?.queries).toEqual([
      {
        package: { name: "lodash", ecosystem: "npm" },
        version: "4.17.20",
      },
    ]);
    expect(JSON.stringify(capturedBody)).not.toMatch(/source|content|file/i);
  });

  it("returns mapped vulnerabilities for vulnerable dependency", async () => {
    const fetchImpl = async () =>
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
                      ranges: [{ events: [{ introduced: "4.0.0", fixed: "4.17.21" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      }) as Response;

    const results = await queryOsvBatch(
      [{ name: "lodash", version: "4.17.20", ecosystem: "npm", purl: "pkg:npm/lodash@4.17.20" }],
      { fetchImpl }
    );

    const vulns = results.get("pkg:npm/lodash@4.17.20");
    expect(vulns).toHaveLength(1);
    expect(vulns?.[0]?.advisoryId).toBe("CVE-2021-23337");
    expect(vulns?.[0]?.fixedVersion).toBe("4.17.21");
    expect(vulns?.[0]?.severity).toBe("high");
  });

  it("returns empty map for non-vulnerable dependency", async () => {
    const fetchImpl = async () =>
      ({
        ok: true,
        json: async () => ({ results: [{ vulns: [] }] }),
      }) as Response;

    const results = await queryOsvBatch(
      [{ name: "leftpad", version: "1.0.0", ecosystem: "npm", purl: "pkg:npm/leftpad@1.0.0" }],
      { fetchImpl }
    );
    expect(results.size).toBe(0);
  });

  it("throws on network failure", async () => {
    const fetchImpl = async () => {
      throw new Error("Network error");
    };

    await expect(
      queryOsvBatch(
        [{ name: "lodash", version: "4.17.20", ecosystem: "npm", purl: "pkg:npm/lodash@4.17.20" }],
        { fetchImpl, timeoutMs: 1000 }
      )
    ).rejects.toBeInstanceOf(OsvQueryError);
  });

  it("throws on malformed response", async () => {
    const fetchImpl = async () =>
      ({
        ok: true,
        json: async () => ({ unexpected: true }),
      }) as Response;

    await expect(
      queryOsvBatch(
        [{ name: "lodash", version: "4.17.20", ecosystem: "npm", purl: "pkg:npm/lodash@4.17.20" }],
        { fetchImpl }
      )
    ).rejects.toMatchObject({ code: "malformed_response" });
  });

  it("throws when OSV is unavailable", async () => {
    const fetchImpl = async () =>
      ({
        ok: false,
        status: 503,
      }) as Response;

    await expect(
      queryOsvBatch(
        [{ name: "lodash", version: "4.17.20", ecosystem: "npm", purl: "pkg:npm/lodash@4.17.20" }],
        { fetchImpl }
      )
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("uses memory cache for repeated package queries", async () => {
    let fetchCount = 0;
    const fetchImpl = async () => {
      fetchCount += 1;
      return {
        ok: true,
        json: async () => ({
          results: [{ vulns: [{ id: "OSV-1", summary: "test" }] }],
        }),
      } as Response;
    };
    const cache = new Map();
    const pkg = [{ name: "cached-pkg", version: "1.0.0", ecosystem: "npm" as const, purl: "pkg:npm/cached-pkg@1.0.0" }];

    await queryOsvBatch(pkg, { fetchImpl, cache });
    await queryOsvBatch(pkg, { fetchImpl, cache });

    expect(fetchCount).toBe(1);
  });

  it("skips components with unknown versions", () => {
    const components = [
      createSbomComponent({ name: "broken", version: "unknown", ecosystem: "npm" }),
      createSbomComponent({ name: "lodash", version: "4.17.20", ecosystem: "npm" }),
    ];
    expect(componentsToOsvPackages(components)).toHaveLength(1);
  });

  it("maps unknown package responses to null entries", () => {
    const mapped = mapOsvVulnerability({ id: "OSV-UNKNOWN" }, {
      name: "does-not-exist",
      version: "0.0.0",
      ecosystem: "npm",
      purl: "pkg:npm/does-not-exist@0.0.0",
    });
    expect(mapped?.osvId).toBe("OSV-UNKNOWN");
  });
});
