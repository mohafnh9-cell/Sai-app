import { describe, expect, it } from "vitest";
import {
  analyzeOsvSbomEvidence,
  dedupeOsvFindings,
  osvBatchToFindings,
  osvVulnerabilityToFinding,
} from "../osv/enrich-sbom";
import { mapOsvVulnerability } from "../osv/map-vulnerability";
import { createSbomComponent } from "../sbom/component";
import { securityAnalysisFindingToDraft } from "../to-finding-draft";

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
      "node_modules/lodash": { version: "4.17.20" },
      "node_modules/leftpad": { version: "1.0.0" },
    },
  },
  null,
  2
);

const lodashComponent = createSbomComponent({
  name: "lodash",
  version: "4.17.20",
  ecosystem: "npm",
  lockfilePath: "package-lock.json",
});

const lodashVuln = mapOsvVulnerability(
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
  {
    name: "lodash",
    version: "4.17.20",
    ecosystem: "npm",
    purl: lodashComponent.purl,
  }
)!;

describe("osv enrich sbom", () => {
  it("creates SecurityAnalysisFinding with required OSV evidence fields", () => {
    const finding = osvVulnerabilityToFinding(lodashComponent, lodashVuln, [
      { path: "package-lock.json", content: PACKAGE_LOCK },
    ]);

    expect(finding.sourceTool).toBe("osv");
    expect(finding.metadata?.osv).toMatchObject({
      package: "lodash",
      installedVersion: "4.17.20",
      ecosystem: "npm",
      advisoryId: "CVE-2021-23337",
      osvId: "GHSA-xxxx-yyyy-zzzz",
      affectedVersionRange: "4.0.0 – 4.17.21",
      fixedVersion: "4.17.21",
      evidenceSource: "osv.dev",
    });
    expect(finding.evidence).toContain("Source: OSV");
  });

  it("never auto-confirms OSV findings", () => {
    const finding = osvVulnerabilityToFinding(lodashComponent, lodashVuln, []);
    expect(finding.verificationStatus).toBe("LIKELY");

    const draft = securityAnalysisFindingToDraft(finding);
    expect(draft.metadata?.securityAnalysis).toMatchObject({
      verificationStatus: "LIKELY",
    });
    expect(draft.metadata?.evidenceReport).toMatchObject({
      confirmationStatus: "potential_vulnerability",
    });
    expect(draft.metadata?.evidenceReport).not.toMatchObject({
      confirmationStatus: "confirmed",
    });
  });

  it("maps POTENTIAL verification for lower-confidence OSV advisories", () => {
    const lowConfidenceVuln = mapOsvVulnerability(
      { id: "OSV-LOW", summary: "Minor issue" },
      {
        name: "lodash",
        version: "4.17.20",
        ecosystem: "npm",
        purl: lodashComponent.purl,
      }
    )!;
    const finding = osvVulnerabilityToFinding(lodashComponent, lowConfidenceVuln, []);
    expect(finding.verificationStatus).toBe("POTENTIAL");
    expect(finding.confidence).toBe("LOW");
  });

  it("handles multiple vulnerabilities for one package", () => {
    const batch = new Map([
      [
        lodashComponent.purl,
        [
          lodashVuln,
          mapOsvVulnerability({ id: "OSV-SECOND", aliases: ["CVE-2024-0002"], summary: "Second issue" }, {
            name: "lodash",
            version: "4.17.20",
            ecosystem: "npm",
            purl: lodashComponent.purl,
          })!,
        ],
      ],
    ]);

    const findings = osvBatchToFindings([lodashComponent], batch, [
      { path: "package-lock.json", content: PACKAGE_LOCK },
    ]);
    expect(findings).toHaveLength(2);
  });

  it("deduplicates duplicate OSV findings", () => {
    const finding = osvVulnerabilityToFinding(lodashComponent, lodashVuln, []);
    const deduped = dedupeOsvFindings([finding, finding]);
    expect(deduped).toHaveLength(1);
  });

  it("returns no findings for non-vulnerable dependency", async () => {
    const fetchImpl = async () =>
      ({
        ok: true,
        json: async () => ({ results: [{ vulns: [] }, { vulns: [] }] }),
      }) as Response;

    const result = await analyzeOsvSbomEvidence(
      [
        { path: "package.json", content: '{"name":"demo-app","version":"1.0.0"}' },
        { path: "package-lock.json", content: PACKAGE_LOCK },
      ],
      { osv: { fetchImpl } }
    );

    expect(result.findings).toHaveLength(0);
    expect(result.snapshot.components.length).toBeGreaterThan(0);
  });

  it("returns vulnerable dependency findings with fixed version guidance", async () => {
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
            { vulns: [] },
          ],
        }),
      }) as Response;

    const result = await analyzeOsvSbomEvidence(
      [
        { path: "package.json", content: '{"name":"demo-app","version":"1.0.0"}' },
        { path: "package-lock.json", content: PACKAGE_LOCK },
      ],
      { osv: { fetchImpl } }
    );

    expect(result.findings.some((finding) => finding.title.includes("CVE-2021-23337"))).toBe(true);
    expect(result.findings[0]?.remediation).toContain("4.17.21");
  });

  it("handles unknown package with no OSV matches", async () => {
    const fetchImpl = async () =>
      ({
        ok: true,
        json: async () => ({ results: [{ vulns: [] }] }),
      }) as Response;

    const result = await analyzeOsvSbomEvidence(
      [
        {
          path: "package-lock.json",
          content: JSON.stringify({
            name: "demo-app",
            lockfileVersion: 3,
            packages: {
              "": { dependencies: { "totally-unknown-pkg": "0.0.1" } },
              "node_modules/totally-unknown-pkg": { version: "0.0.1" },
            },
          }),
        },
      ],
      { osv: { fetchImpl } }
    );

    expect(result.findings).toHaveLength(0);
  });

  it("gracefully handles OSV unavailable without throwing", async () => {
    const fetchImpl = async () =>
      ({
        ok: false,
        status: 503,
      }) as Response;

    const result = await analyzeOsvSbomEvidence(
      [
        { path: "package-lock.json", content: PACKAGE_LOCK },
      ],
      { osv: { fetchImpl } }
    );

    expect(result.findings).toHaveLength(0);
    expect(result.osvError).toMatch(/unavailable/i);
  });

  it("gracefully handles network failure without throwing", async () => {
    const fetchImpl = async () => {
      throw new Error("Network error");
    };

    const result = await analyzeOsvSbomEvidence(
      [{ path: "package-lock.json", content: PACKAGE_LOCK }],
      { osv: { fetchImpl, timeoutMs: 1000 } }
    );

    expect(result.findings).toHaveLength(0);
    expect(result.osvError).toBeTruthy();
  });
});
