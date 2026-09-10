import { describe, expect, it } from "vitest";
import { crossEngineDeduplication } from "../deduplicate";
import type { SequrAIFinding } from "@/server/security-evidence/canonical-finding";

/**
 * Phase 35, section 32: the exact three fixture scenarios from the brief.
 */

function finding(overrides: Partial<SequrAIFinding> & { id: string }): SequrAIFinding {
  const now = new Date().toISOString();
  return {
    fingerprint: overrides.id,
    title: "finding",
    description: "d",
    category: "injection",
    severity: "high",
    confidence: "medium",
    exploitability: { level: "LOW", confidence: 0.3, evidenceIds: [] },
    verificationStatus: "POTENTIAL",
    sources: ["native_scanner"],
    evidence: [],
    affectedFiles: ["app/route.ts"],
    affectedEndpoints: [],
    affectedAssets: [],
    remediation: null,
    references: [],
    cwe: ["CWE-89"],
    owasp: [],
    mitre: [],
    scanId: "scan-1",
    projectId: "project-1",
    organizationId: "org-1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function withLine(f: SequrAIFinding, line: number): SequrAIFinding {
  return {
    ...f,
    evidence: [
      { id: `${f.id}:ev`, kind: "AST", label: "x", detail: JSON.stringify({ location: { line } }), capturedAt: f.createdAt },
    ],
  };
}

describe("Phase 35 -- crossEngineDeduplication (section 32)", () => {
  it("fixture 1: native SQL injection + OpenGrep SQL injection (taint) at the same location -> ONE correlated group", () => {
    const native = withLine(finding({ id: "native:sqli-1", sources: ["native_scanner"], category: "injection", cwe: ["CWE-89"] }), 10);
    const opengrep = withLine(finding({ id: "opengrep:sqli-1", sources: ["external_engine"], category: "injection", cwe: ["CWE-89"] }), 12);

    const groups = crossEngineDeduplication([native, opengrep]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("same_issue");
    expect(groups[0]?.findingIds).toEqual(expect.arrayContaining(["native:sqli-1", "opengrep:sqli-1"]));
  });

  it("fixture 2: native SQL injection + OpenGrep command injection (different vulnerability class) -> TWO separate findings, no merge", () => {
    const native = withLine(finding({ id: "native:sqli-1", sources: ["native_scanner"], category: "injection", cwe: ["CWE-89"] }), 10);
    const opengrepCmd = withLine(
      finding({ id: "opengrep:cmdi-1", sources: ["external_engine"], category: "injection", cwe: ["CWE-78"] }),
      10
    );

    const groups = crossEngineDeduplication([native, opengrepCmd]);

    expect(groups).toHaveLength(0);
  });

  it("fixture 3: same file, same CWE, but different vulnerable sinks far apart in the file -> do NOT blindly merge", () => {
    const native = withLine(finding({ id: "native:sqli-1", sources: ["native_scanner"], category: "injection", cwe: ["CWE-89"] }), 5);
    const opengrepFar = withLine(
      finding({ id: "opengrep:sqli-2", sources: ["external_engine"], category: "injection", cwe: ["CWE-89"] }),
      200
    );

    const groups = crossEngineDeduplication([native, opengrepFar]);

    expect(groups).toHaveLength(0);
  });

  it("never merges two findings from the exact same single engine (within-engine duplicates are out of scope here)", () => {
    const a = withLine(finding({ id: "native:sqli-a", sources: ["native_scanner"] }), 10);
    const b = withLine(finding({ id: "native:sqli-b", sources: ["native_scanner"] }), 10);

    const groups = crossEngineDeduplication([a, b]);

    expect(groups).toHaveLength(0);
  });

  it("keeps findings separate when line evidence is missing on either side, even with matching file+CWE", () => {
    const native = finding({ id: "native:sqli-1", sources: ["native_scanner"], evidence: [] });
    const opengrep = withLine(finding({ id: "opengrep:sqli-1", sources: ["external_engine"] }), 10);

    const groups = crossEngineDeduplication([native, opengrep]);

    expect(groups).toHaveLength(0);
  });
});
