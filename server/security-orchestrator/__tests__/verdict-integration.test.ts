import { describe, expect, it } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { hasIncompleteExternalEngineCoverage, loadExternalEngineFindingsForVerdict } from "../verdict-integration";

const ORG_A = "org-a";
const SCAN_A = "scan-a";

function externalRow(overrides: Partial<Record<string, unknown>> & { finding_id: string }) {
  return {
    organization_id: ORG_A,
    scan_id: SCAN_A,
    engine: "opengrep",
    engine_version: "1.30.0",
    title: "SQL injection",
    severity: "high",
    category: "injection",
    confidence: "high",
    evidence: [{ detail: "req.query.id -> db.raw(query)" }],
    affected_files: ["app/users.js"],
    remediation: "Use a parameterized query.",
    cwe: ["CWE-89"],
    ...overrides,
  };
}

describe("Phase 37 -- loadExternalEngineFindingsForVerdict (workstream C)", () => {
  it("includes external findings that are not correlated with anything, mapped to the verdict engine's expected shape", async () => {
    const t: FakeTables = {
      external_engine_findings: [externalRow({ finding_id: "opengrep:abc" })],
      finding_correlations: [],
    };
    const admin = createFakeAdmin(t);

    const result = await loadExternalEngineFindingsForVerdict(admin as never, {
      scanId: SCAN_A,
      organizationId: ORG_A,
      nativeFindingIds: new Set(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "opengrep:abc", title: "SQL injection", severity: "high" });
    expect(result[0]?.evidence).toContain("db.raw(query)");
  });

  it("suppresses an external finding that is correlated (same_issue) with a native finding already in the score -- no double counting", async () => {
    const t: FakeTables = {
      external_engine_findings: [externalRow({ finding_id: "opengrep:abc" })],
      finding_correlations: [
        { organization_id: ORG_A, scan_id: SCAN_A, finding_ids: ["native-finding-1", "opengrep:abc"], kind: "same_issue" },
      ],
    };
    const admin = createFakeAdmin(t);

    const result = await loadExternalEngineFindingsForVerdict(admin as never, {
      scanId: SCAN_A,
      organizationId: ORG_A,
      nativeFindingIds: new Set(["native-finding-1"]),
    });

    expect(result).toHaveLength(0);
  });

  it("keeps only ONE representative when two external findings (no native counterpart) are correlated as the same issue", async () => {
    const t: FakeTables = {
      external_engine_findings: [
        externalRow({ finding_id: "opengrep:abc", engine: "opengrep" }),
        externalRow({ finding_id: "trivy:def", engine: "trivy", title: "Also SQL injection-adjacent" }),
      ],
      finding_correlations: [{ organization_id: ORG_A, scan_id: SCAN_A, finding_ids: ["opengrep:abc", "trivy:def"], kind: "same_issue" }],
    };
    const admin = createFakeAdmin(t);

    const result = await loadExternalEngineFindingsForVerdict(admin as never, {
      scanId: SCAN_A,
      organizationId: ORG_A,
      nativeFindingIds: new Set(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("opengrep:abc");
  });

  it("returns an empty array (never throws) when there are no external findings for this scan", async () => {
    const admin = createFakeAdmin({ external_engine_findings: [], finding_correlations: [] });
    const result = await loadExternalEngineFindingsForVerdict(admin as never, {
      scanId: SCAN_A,
      organizationId: ORG_A,
      nativeFindingIds: new Set(),
    });
    expect(result).toEqual([]);
  });
});

describe("F10 -- hasIncompleteExternalEngineCoverage (partialScanFailure honesty)", () => {
  function jobRow(overrides: Partial<Record<string, unknown>> & { status: string }) {
    return {
      id: `job-${Math.random()}`,
      organization_id: ORG_A,
      scan_id: SCAN_A,
      engine: "opengrep",
      ...overrides,
    };
  }

  it("returns true when an engine job for this scan is FAILED -- a crashed engine must make the verdict honestly partial", async () => {
    const admin = createFakeAdmin({ security_jobs: [jobRow({ status: "FAILED" })] });
    const result = await hasIncompleteExternalEngineCoverage(admin as never, { scanId: SCAN_A, organizationId: ORG_A });
    expect(result).toBe(true);
  });

  it("returns true when an engine job is still QUEUED/RUNNING -- coverage isn't in yet", async () => {
    const admin = createFakeAdmin({ security_jobs: [jobRow({ status: "RUNNING" })] });
    const result = await hasIncompleteExternalEngineCoverage(admin as never, { scanId: SCAN_A, organizationId: ORG_A });
    expect(result).toBe(true);
  });

  it("returns false when every engine job for this scan COMPLETED", async () => {
    const admin = createFakeAdmin({
      security_jobs: [jobRow({ status: "COMPLETED", engine: "opengrep" }), jobRow({ status: "COMPLETED", engine: "trivy" })],
    });
    const result = await hasIncompleteExternalEngineCoverage(admin as never, { scanId: SCAN_A, organizationId: ORG_A });
    expect(result).toBe(false);
  });

  it("returns false (not a failure) when no external-engine jobs were ever planned for this scan", async () => {
    const admin = createFakeAdmin({ security_jobs: [] });
    const result = await hasIncompleteExternalEngineCoverage(admin as never, { scanId: SCAN_A, organizationId: ORG_A });
    expect(result).toBe(false);
  });

  it("never lets another organization's failed job affect this scan's coverage (tenant-scoped)", async () => {
    const admin = createFakeAdmin({
      security_jobs: [jobRow({ status: "FAILED", organization_id: "org-b", scan_id: SCAN_A })],
    });
    const result = await hasIncompleteExternalEngineCoverage(admin as never, { scanId: SCAN_A, organizationId: ORG_A });
    expect(result).toBe(false);
  });
});
